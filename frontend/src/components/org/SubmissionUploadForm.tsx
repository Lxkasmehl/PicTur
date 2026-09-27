import { useEffect, useState } from 'react';
import {
  Button,
  Group,
  Image,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { IconCurrentLocation, IconPhoto, IconUpload } from '@tabler/icons-react';
import { acceptUploadFile } from '../../utils/uploadFilePipeline';
import { getCurrentLocation } from '../../services/geolocation';
import {
  createSubmission,
  getRegions,
  regionOptions,
  type Region,
  type Submission,
} from '../../services/api/orgData';

interface SubmissionUploadFormProps {
  slug: string;
  submitLabel: string;
  onUploaded: (submission: Submission) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Carapace photo + where/when it was taken. Used by staff and community uploads alike. */
export function SubmissionUploadForm({ slug, submitLabel, onUploaded }: SubmissionUploadFormProps) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [observedAt, setObservedAt] = useState(today());
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getRegions(slug).then(setRegions).catch(() => setRegions([]));
  }, [slug]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onDrop = async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    setPreparing(true);
    const result = await acceptUploadFile(picked);
    setPreparing(false);
    if (!result.isValid || !result.file) {
      notifications.show({ color: 'red', title: 'Photo not accepted', message: result.error || 'Invalid file' });
      return;
    }
    setFile(result.file);
  };

  const useMyLocation = async () => {
    const res = await getCurrentLocation();
    if (res.location) {
      setCoords({ lat: res.location.latitude, lon: res.location.longitude });
    } else {
      notifications.show({
        color: 'orange',
        title: 'Location unavailable',
        message: res.permissionDenied ? 'Location permission was denied.' : 'Could not determine your location.',
      });
    }
  };

  const submit = async () => {
    if (!file) return;
    setSubmitting(true);
    try {
      const submission = await createSubmission(slug, {
        file,
        region_id: regionId ? Number(regionId) : null,
        observed_at: observedAt || null,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        notes: notes.trim() || undefined,
      });
      setFile(null);
      setNotes('');
      setCoords(null);
      onUploaded(submission);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Upload failed', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Paper withBorder p='md' radius='md'>
      <Stack gap='md'>
        {preview ? (
          <Stack gap='xs' align='center'>
            <Image src={preview} alt='Selected carapace photo' mah={320} fit='contain' radius='sm' />
            <Button variant='subtle' size='xs' onClick={() => setFile(null)}>
              Choose another photo
            </Button>
          </Stack>
        ) : (
          <Dropzone
            onDrop={onDrop}
            accept={[...IMAGE_MIME_TYPE, 'image/heic', 'image/heif']}
            multiple={false}
            loading={preparing}
            data-testid='org-upload-dropzone'
          >
            <Group justify='center' gap='md' mih={140} style={{ pointerEvents: 'none' }}>
              <Dropzone.Accept>
                <IconUpload size={40} />
              </Dropzone.Accept>
              <Dropzone.Idle>
                <IconPhoto size={40} />
              </Dropzone.Idle>
              <div>
                <Text size='lg'>Drop a carapace photo here or click to select</Text>
                <Text size='sm' c='dimmed'>
                  Photograph the shell from above, filling most of the frame.
                </Text>
              </div>
            </Group>
          </Dropzone>
        )}

        <Group grow align='flex-start'>
          <Select
            label='Region'
            placeholder={regions.length ? 'Select region' : 'No regions defined'}
            data={regionOptions(regions)}
            value={regionId}
            onChange={setRegionId}
            clearable
            searchable
          />
          <TextInput
            label='Date observed'
            type='date'
            value={observedAt}
            max={today()}
            onChange={(e) => setObservedAt(e.currentTarget.value)}
          />
        </Group>

        <Group gap='xs'>
          <Button variant='light' size='xs' leftSection={<IconCurrentLocation size={14} />} onClick={useMyLocation}>
            Use my location
          </Button>
          {coords && (
            <Text size='xs' c='dimmed'>
              {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
            </Text>
          )}
        </Group>

        <Textarea
          label='Notes'
          placeholder='Anything noteworthy (behaviour, injuries, exact spot, ...)'
          autosize
          minRows={2}
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />

        <Button
          onClick={submit}
          disabled={!file}
          loading={submitting}
          leftSection={<IconUpload size={16} />}
          data-testid='org-upload-submit'
        >
          {submitLabel}
        </Button>
      </Stack>
    </Paper>
  );
}
