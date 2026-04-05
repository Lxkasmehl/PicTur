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
  getUsers,
  setUserRole,
  isStaffRole,
} from './api/auth';
export type {
  User,
  UserRole,
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  InvitationDetails,
  PromoteToAdminResponse,
  GetUsersResponse,
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
  classifyReviewPacket,
  crossCheckReviewPacket,
} from './api/turtle';
export type {
  PhotoType,
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
  listCommunitySheets,
  getLocations,
  getGeneralLocationCatalog,
  addGeneralLocation,
  createSheet,
  getTurtleNames,
  listAllTurtlesFromSheets,
} from './api/sheets';
export type {
  TurtleSheetsData,
  GetTurtleSheetsDataResponse,
  GetLocationsResponse,
  GeneralLocationCatalog,
  GeneralLocationCatalogResponse,
  AddGeneralLocationRequest,
  AddGeneralLocationResponse,
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
