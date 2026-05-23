/**
 * PicTur API – photo upload, review queue, matching, turtle images
 */

export { uploadTurtlePhoto } from './upload';

export {
  getReviewQueue,
  uploadReviewPacketAdditionalImages,
  getReviewPacket,
  removeReviewPacketAdditionalImage,
  approveReview,
  crossCheckReviewPacket,
  classifyReviewPacket,
  deleteReviewItem,
} from './review';

export { getTurtlesWithFlags, clearReleaseFlag } from './flags';

export {
  getImageUrl,
  getTurtleImageDownloadUrl,
  getTurtleImages,
  searchTurtleImagesByLabel,
  updateTurtleAdditionalImageLabels,
  setTurtleImageLabels,
  getTurtlePrimariesBatch,
  uploadTurtleReplaceReference,
  uploadTurtleIdentifierPlastron,
  uploadTurtleAdditionalImages,
  deleteTurtleAdditionalImage,
  deleteTurtleImage,
  restoreTurtleImage,
} from './images';

export { RestoreCollisionError } from './types';

export type {
  TurtleMatch,
  PhotoType,
  UploadPhotoResponse,
  LocationHint,
  AdditionalImageType,
  AdditionalImage,
  ReviewQueueItem,
  FindMetadata,
  ReviewQueueResponse,
  ApproveReviewRequest,
  ApproveReviewResponse,
  UploadFlagOptions,
  UploadExtraFile,
  GetImageUrlOptions,
  TurtleImageAdditional,
  TurtleLooseSource,
  TurtleLooseImage,
  TurtlePrimaryInfo,
  TurtleDeletedCategory,
  TurtleDeletedImage,
  TurtleAdditionalLabelSearchMatch,
  TurtleImagesResponse,
  DeleteTurtleImageResponse,
  RestoreTurtleImageResponse,
} from './types';
