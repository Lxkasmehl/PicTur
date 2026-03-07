/**
 * API Service – single entry point for backend communication.
 * Modules: api/config, api/auth, api/turtle, api/sheets.
 */

export {
  AUTH_API_BASE_URL,
  TURTLE_API_BASE_URL,
  getToken,
  setToken,
  removeToken,
} from './api/config';

export {
  apiRequest,
  register,
  login,
  getCurrentUser,
  logout,
  getGoogleAuthUrl,
  getInvitationDetails,
  verifyEmail,
  resendVerificationEmail,
  promoteToAdmin,
} from './api/auth';
export type {
  User,
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  InvitationDetails,
  PromoteToAdminResponse,
} from './api/auth';

export {
  uploadTurtlePhoto,
  getReviewQueue,
  uploadReviewPacketAdditionalImages,
  getReviewPacket,
  removeReviewPacketAdditionalImage,
  approveReview,
  deleteReviewItem,
  getTurtlesWithFlags,
  clearReleaseFlag,
  getImageUrl,
  getTurtleImages,
  getTurtlePrimariesBatch,
  uploadTurtleAdditionalImages,
  deleteTurtleAdditionalImage,
} from './api/turtle';
export type {
  TurtleMatch,
  UploadPhotoResponse,
  LocationHint,
  AdditionalImage,
  ReviewQueueItem,
  FindMetadata,
  ReviewQueueResponse,
  ApproveReviewRequest,
  ApproveReviewResponse,
  UploadFlagOptions,
  UploadExtraFile,
  TurtleImageAdditional,
  TurtleImagesResponse,
} from './api/turtle';

export {
  getTurtleSheetsData,
  createTurtleSheetsData,
  updateTurtleSheetsData,
  generatePrimaryId,
  generateTurtleId,
  listSheets,
  createSheet,
  getTurtleNames,
  listAllTurtlesFromSheets,
} from './api/sheets';
export type {
  TurtleSheetsData,
  GetTurtleSheetsDataResponse,
  ListSheetsResponse,
  GeneratePrimaryIdRequest,
  GeneratePrimaryIdResponse,
  GenerateTurtleIdRequest,
  GenerateTurtleIdResponse,
  CreateTurtleSheetsDataRequest,
  CreateTurtleSheetsDataResponse,
  UpdateTurtleSheetsDataRequest,
  UpdateTurtleSheetsDataResponse,
  CreateSheetRequest,
  CreateSheetResponse,
  TurtleNameEntry,
  ListTurtleNamesResponse,
  ListTurtlesResponse,
} from './api/sheets';
