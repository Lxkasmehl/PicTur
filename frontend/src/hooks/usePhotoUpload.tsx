import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconAlertCircle } from '@tabler/icons-react';
import { validateFile } from '../utils/fileValidation';
import { getCurrentLocation } from '../services/geolocation';
import {
  uploadTurtlePhoto,
  type UploadPhotoResponse,
  type LocationHint,
  type UploadFlagOptions,
  type UploadExtraFile,
  type FindMetadata,
} from '../services/api';
import { useUser } from './useUser';
import type { FileWithPath } from '../types/file';

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

export interface CommunitySightMeta {
  hasGps: boolean;
  hasManual: boolean;
  extraPhotoCount: number;
}

interface UsePhotoUploadOptions {
  role?: string;
  onSuccess?: (imageId: string) => void;
  /** After a successful upload: community flow always; staff/admin match flow before navigating away. */
  onCommunitySightRecorded?: (meta: CommunitySightMeta) => void;
  /** Admin/Staff: sheet name (location) to test against; '' = all locations */
  matchSheet?: string;
}

interface UsePhotoUploadReturn {
  files: FileWithPath[];
  preview: string | null;
  uploadState: UploadState;
  uploadProgress: number;
  uploadResponse: string | null;
  imageId: string | null;
  isDuplicate: boolean;
  previousUploadDate: string | null;
  isGettingLocation: boolean;
  /** True when the user has denied location permission (show "allow in settings" message). */
  locationPermissionDenied: boolean;
  /** Optional location hint (coords) – only in queue, never in sheets */
  locationHint: LocationHint | null;
  setLocationHint: (hint: LocationHint | null) => void;
  /** Request current GPS as location hint (community: permission flow) */
  requestLocationHint: () => Promise<void>;
  /** Flag options (collected to lab, physical flag, digital flag) – community upload */
  collectedToLab: 'yes' | 'no' | null;
  setCollectedToLab: (v: 'yes' | 'no' | null) => void;
  physicalFlag: 'yes' | 'no' | 'no_flag' | null;
  setPhysicalFlag: (v: 'yes' | 'no' | 'no_flag' | null) => void;
  /** Optional extra images (all additional-photo categories) – upload with main photo */
  extraFiles: UploadExtraFile[];
  setExtraFiles: (files: UploadExtraFile[] | ((prev: UploadExtraFile[]) => UploadExtraFile[])) => void;
  handleDrop: (acceptedFiles: FileWithPath[]) => void;
  handleUpload: () => Promise<void>;
  handleRemove: () => void;
}

export function usePhotoUpload({
  role,
  onSuccess,
  onCommunitySightRecorded,
  matchSheet,
}: UsePhotoUploadOptions = {}): UsePhotoUploadReturn {
  const navigate = useNavigate();
  const { user } = useUser();
  const [files, setFiles] = useState<FileWithPath[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResponse, setUploadResponse] = useState<string | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [previousUploadDate, setPreviousUploadDate] = useState<string | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);
  const [locationHint, setLocationHint] = useState<LocationHint | null>(null);
  const [collectedToLab, setCollectedToLab] = useState<'yes' | 'no' | null>(null);
  const [physicalFlag, setPhysicalFlag] = useState<'yes' | 'no' | 'no_flag' | null>(null);
  const [extraFiles, setExtraFiles] = useState<UploadExtraFile[]>([]);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, []);

  const handleDrop = (acceptedFiles: FileWithPath[]): void => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];

      // Validation
      const validation = validateFile(file);
      if (!validation.isValid) {
        notifications.show({
          title: 'Invalid File',
          message: validation.error || 'File could not be validated',
          color: 'red',
          icon: <IconAlertCircle size={18} />,
        });
        return;
      }

      setFiles(acceptedFiles);
      setUploadState('idle');
      setUploadResponse(null);
      setImageId(null);
      setIsDuplicate(false);
      setPreviousUploadDate(null);
      setLocationHint(null);
      setCollectedToLab(null);
      setPhysicalFlag(null);
      setExtraFiles([]);
      setLocationPermissionDenied(false);

      // Create preview
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async (): Promise<void> => {
    if (files.length === 0 || !preview) return;

    const file = files[0];
    setUploadState('uploading');
    setUploadProgress(0);
    setUploadResponse(null);

    // Clear any existing interval
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    // Simulate progress animation
    progressIntervalRef.current = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      // Upload to backend API (location hint is collected explicitly in UI for community)
      // Authentication is optional - anonymous uploads are allowed
      const userRole: 'admin' | 'staff' | 'community' =
        (role === 'admin' || role === 'staff' || role === 'community' ? role : null) ||
        (user?.role === 'admin' || user?.role === 'staff' || user?.role === 'community' ? user.role : null) ||
        'community';
      const isAdminFlow = userRole === 'admin' || userRole === 'staff';
      const userEmail = user?.email || 'anonymous@example.com';

      const hasFlagData =
        collectedToLab || physicalFlag || (locationHint && collectedToLab === 'yes');
      const flagOptions: UploadFlagOptions | undefined =
        hasFlagData && (userRole === 'community' || userRole === 'admin' || userRole === 'staff')
          ? {
              ...(collectedToLab && { collectedToLab }),
              ...(physicalFlag && { physicalFlag }),
              ...(locationHint && collectedToLab === 'yes' && {
                digitalFlag: locationHint,
              }),
            }
          : undefined;

      const response: UploadPhotoResponse = await uploadTurtlePhoto(
        file,
        userRole,
        userEmail,
        undefined,
        locationHint ?? undefined,
        isAdminFlow ? (matchSheet ?? '') : undefined,
        flagOptions,
        extraFiles.length > 0 ? extraFiles : undefined
      );

      // Clear interval and set to 100%
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setUploadProgress(100);

      if (response.success) {
        // Admin/Staff: Always navigate to match page (even if no matches found)
        if (isAdminFlow && response.request_id) {
          onCommunitySightRecorded?.({
            hasGps: locationHint?.source === 'gps',
            hasManual: locationHint?.source === 'manual',
            extraPhotoCount: extraFiles.length,
          });
          // Build find_metadata from upload so match page doesn't ask again for physical/digital flag
          const find_metadata_from_upload: FindMetadata | undefined = hasFlagData
            ? {
                ...(collectedToLab && { collected_to_lab: collectedToLab }),
                ...(physicalFlag && { physical_flag: physicalFlag }),
                ...(locationHint &&
                  collectedToLab === 'yes' && {
                    digital_flag_lat: locationHint.latitude,
                    digital_flag_lon: locationHint.longitude,
                    digital_flag_source: locationHint.source,
                  }),
              }
            : undefined;
          const matchData = {
            request_id: response.request_id,
            uploaded_image_path: response.uploaded_image_path || '',
            matches: response.matches || [], // Empty array if no matches
            ...(find_metadata_from_upload && Object.keys(find_metadata_from_upload).length > 0 && {
              find_metadata_from_upload,
            }),
          };
          localStorage.setItem(`match_${response.request_id}`, JSON.stringify(matchData));

          // Navigate to turtle match page with request_id
          navigate(`/admin/turtle-match/${response.request_id}`);
          return;
        }

        // Community: Show success message
        setUploadState('success');
        setUploadResponse(response.message);
        setImageId(response.request_id || null);
        setIsDuplicate(false);
        setPreviousUploadDate(null);

        if (response.request_id && onSuccess) {
          onSuccess(response.request_id);
        }

        notifications.show({
          title: 'Upload Successful!',
          message: response.message,
          color: 'green',
          icon: <IconCheck size={18} />,
          autoClose: 5000,
        });

        onCommunitySightRecorded?.({
          hasGps: locationHint?.source === 'gps',
          hasManual: locationHint?.source === 'manual',
          extraPhotoCount: extraFiles.length,
        });
      } else {
        throw new Error(response.message || 'Upload failed');
      }
    } catch (error: unknown) {
      // Clear interval on error
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setUploadProgress(0);
      setUploadState('error');
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error.message as string)
          : 'Upload failed. Please try again.';

      setUploadResponse(errorMessage);

      notifications.show({
        title: 'Upload Failed',
        message: errorMessage,
        color: 'red',
        icon: <IconAlertCircle size={18} />,
        autoClose: 5000,
      });
    }
  };

  const requestLocationHint = async (): Promise<void> => {
    setLocationPermissionDenied(false);
    setIsGettingLocation(true);
    try {
      const result = await getCurrentLocation();
      if (result.permissionDenied) {
        setLocationPermissionDenied(true);
        setLocationHint(null);
      } else if (result.location) {
        setLocationHint({
          latitude: result.location.latitude,
          longitude: result.location.longitude,
          source: 'gps',
        });
      } else {
        setLocationHint(null);
      }
    } catch {
      setLocationHint(null);
    } finally {
      setIsGettingLocation(false);
    }
  };

  const handleRemove = (): void => {
    setFiles([]);
    setPreview(null);
    setUploadState('idle');
    setUploadProgress(0);
    setUploadResponse(null);
    setImageId(null);
    setIsDuplicate(false);
    setPreviousUploadDate(null);
    setLocationHint(null);
    setCollectedToLab(null);
    setPhysicalFlag(null);
    setExtraFiles([]);
  };

  return {
    files,
    preview,
    uploadState,
    uploadProgress,
    uploadResponse,
    imageId,
    isDuplicate,
    previousUploadDate,
    isGettingLocation,
    locationPermissionDenied,
    locationHint,
    setLocationHint,
    requestLocationHint,
    collectedToLab,
    setCollectedToLab,
    physicalFlag,
    setPhysicalFlag,
    extraFiles,
    setExtraFiles,
    handleDrop,
    handleUpload,
    handleRemove,
  };
}
