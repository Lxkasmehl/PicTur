# Frontend Implementation Documentation

## Table of Contents
1. [Design Approach](#design-approach)
2. [Architecture Overview](#architecture-overview)
3. [Component Architecture](#component-architecture)
4. [State Management](#state-management)
5. [API Service Layer](#api-service-layer)
6. [Custom Hooks](#custom-hooks)
7. [Component Hierarchy](#component-hierarchy)
8. [Data Flow Diagrams](#data-flow-diagrams)

---

## Design Approach

### Overview
The frontend is built using **React 19** with **TypeScript**, following a modern component-based architecture. The application uses:

- **React Router** for client-side routing
- **Redux Toolkit** for state management
- **Mantine UI** for component library and theming
- **Custom Hooks** for reusable business logic
- **Service Layer** for API communication

### Key Design Principles

1. **Component-Based Architecture**: UI is broken down into reusable, composable components
2. **Separation of Concerns**: Clear separation between presentation (components), business logic (hooks), and data (services)
3. **Type Safety**: Full TypeScript coverage for better developer experience and fewer runtime errors
4. **State Management**: Centralized state with Redux for global state, local state for component-specific data
5. **Responsive Design**: Mobile-first approach with Mantine's responsive utilities
6. **Theme System**: Role-based theming (community vs admin) for visual distinction

### Technology Stack

- **Framework**: React 19.1.1
- **Language**: TypeScript 5.8.3
- **Build Tool**: Vite 7.1.7
- **State Management**: Redux Toolkit 2.9.2
- **Routing**: React Router DOM 7.9.4
- **UI Library**: Mantine 8.3.5
- **Icons**: Tabler Icons React 3.35.0
- **Testing**: Playwright 1.56.1

---

## Architecture Overview

```mermaid
graph TB
    subgraph "Frontend Application"
        A[App.tsx] --> B[AuthProvider]
        A --> C[ThemeProvider]
        A --> D[Router]
        D --> E[Pages]
        D --> F[Navigation]
        E --> G[Components]
        E --> H[Custom Hooks]
        H --> I[Redux Store]
        H --> J[API Services]
        G --> I
        G --> H
    end
    
    subgraph "External Services"
        J --> K[Auth Backend<br/>:3001]
        J --> L[PicTur Backend<br/>:5000]
    end
    
    style A fill:#4dabf7
    style I fill:#ff6b6b
    style J fill:#51cf66
```

---

## Component Architecture

### Component Class Diagram

```mermaid
classDiagram
    class App {
        +Provider store
        +AuthProvider children
        +ThemeProvider children
        +Router routes
        +render() JSX
    }
    
    class AuthProvider {
        -dispatch: AppDispatch
        +children: ReactNode
        +checkAuth() void
        +useEffect() void
    }
    
    class Navigation {
        -navigate: NavigateFunction
        -location: Location
        -user: UserInfo
        +children: ReactNode
        +handleLogout() void
        +render() JSX
    }
    
    class HomePage {
        -role: UserRole
        -usePhotoUpload hook
        +handleDrop() void
        +handleReject() void
        +render() JSX
    }
    
    class LoginPage {
        -mode: 'login' | 'signup'
        -email: string
        -password: string
        -loading: boolean
        +handleLogin() void
        +handleRegister() void
        +handleGoogleAuth() void
        +render() JSX
    }
    
    class PhotoCard {
        -photo: UploadedPhoto
        -onPhotoClick: function
        +render() JSX
    }
    
    class PhotoDetailModal {
        -opened: boolean
        -photo: UploadedPhoto
        -onClose() void
        +render() JSX
    }
    
    class PreviewCard {
        -preview: string
        -uploadState: UploadState
        -uploadProgress: number
        -onUpload() void
        -onRemove() void
        +render() JSX
    }
    
    App --> AuthProvider
    App --> Navigation
    App --> HomePage
    App --> LoginPage
    Navigation --> HomePage
    HomePage --> PhotoCard
    HomePage --> PreviewCard
    PhotoCard --> PhotoDetailModal
```

### Component Relationships

```mermaid
graph LR
    A[App] --> B[AuthProvider]
    A --> C[ThemeProvider]
    A --> D[Router]
    
    D --> E[HomePage]
    D --> F[LoginPage]
    D --> G[AboutPage]
    D --> H[ContactPage]
    D --> I[AdminTurtleRecordsPage]
    D --> J[AdminTurtleMatchPage]
    D --> K[AdminUserManagementPage]
    
    E --> L[PreviewCard]
    E --> M[Dropzone]
    
    I --> N[PhotoCard]
    I --> O[PhotoGroupCard]
    
    N --> P[PhotoDetailModal]
    
    style A fill:#4dabf7
    style E fill:#51cf66
    style I fill:#ff6b6b
```

---

## State Management

### Redux Store Architecture

```mermaid
classDiagram
    class ReduxStore {
        +user: UserState
        +theme: ThemeState
        +getState() RootState
        +dispatch() AppDispatch
    }
    
    class UserSlice {
        -role: UserRole
        -isLoggedIn: boolean
        -user: UserInfo | null
        +setRole(role) void
        +setIsLoggedIn(bool) void
        +setUser(user) void
        +login(user) void
        +logout() void
    }
    
    class ThemeSlice {
        -themeType: 'community' | 'admin'
        +setThemeType(type) void
        +communityTheme: MantineTheme
        +adminTheme: MantineTheme
    }
    
    class UserInfo {
        +id: number
        +email: string
        +name: string | null
        +role: UserRole
    }
    
    ReduxStore --> UserSlice
    ReduxStore --> ThemeSlice
    UserSlice --> UserInfo
```

### State Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant Component
    participant Hook
    participant Redux
    participant API
    
    User->>Component: Action (e.g., Login)
    Component->>Hook: useUser().login()
    Hook->>API: login(email, password)
    API-->>Hook: AuthResponse
    Hook->>Redux: dispatch(login(user))
    Redux->>Redux: Update state
    Redux-->>Component: State updated
    Component-->>User: UI updated
```

---

## API Service Layer

### API Service Class Diagram

```mermaid
classDiagram
    class ApiService {
        <<service>>
        +AUTH_API_BASE_URL: string
        +TURTLE_API_BASE_URL: string
        +getToken() string | null
        +setToken(token) void
        +removeToken() void
        +apiRequest(endpoint, options) Promise~Response~
    }
    
    class AuthService {
        +login(data) Promise~AuthResponse~
        +register(data) Promise~AuthResponse~
        +getCurrentUser() Promise~User~
        +logout() Promise~void~
        +getGoogleAuthUrl() string
        +getInvitationDetails(token) Promise~InvitationDetails~
        +promoteToAdmin(email) Promise~PromoteToAdminResponse~
    }
    
    class TurtleService {
        +uploadTurtlePhoto(file, role, email, location) Promise~UploadPhotoResponse~
        +getReviewQueue() Promise~ReviewQueueResponse~
        +approveReview(requestId, data) Promise~ApproveReviewResponse~
        +getImageUrl(imagePath) string
    }
    
    class User {
        +id: number
        +email: string
        +name: string | null
        +role: 'community' | 'admin'
    }
    
    class AuthResponse {
        +success: boolean
        +token: string
        +user: User
    }
    
    class UploadPhotoResponse {
        +success: boolean
        +request_id: string
        +matches: TurtleMatch[]
        +uploaded_image_path: string
        +message: string
    }
    
    ApiService <|-- AuthService
    ApiService <|-- TurtleService
    AuthService --> User
    AuthService --> AuthResponse
    TurtleService --> UploadPhotoResponse
```

### API Request Flow

```mermaid
sequenceDiagram
    participant Component
    participant Hook
    participant ApiService
    participant AuthBackend
    participant TurtleBackend
    
    Note over Component,TurtleBackend: Authentication Flow
    Component->>Hook: useUser().login()
    Hook->>ApiService: login(email, password)
    ApiService->>AuthBackend: POST /api/auth/login
    AuthBackend-->>ApiService: {token, user}
    ApiService->>ApiService: setToken(token)
    ApiService-->>Hook: AuthResponse
    Hook-->>Component: User data
    
    Note over Component,TurtleBackend: Photo Upload Flow
    Component->>Hook: usePhotoUpload().handleUpload()
    Hook->>ApiService: uploadTurtlePhoto(file, role, email, location)
    ApiService->>TurtleBackend: POST /api/upload
    TurtleBackend-->>ApiService: UploadPhotoResponse
    ApiService-->>Hook: Response
    Hook-->>Component: Success/Error
```

---

## Custom Hooks

### Custom Hooks Architecture

```mermaid
classDiagram
    class useUser {
        -dispatch: AppDispatch
        -user: UserInfo | null
        -role: UserRole
        -isLoggedIn: boolean
        +login(email, password) Promise~void~
        +register(data) Promise~void~
        +logout() Promise~void~
        +getUser() UserInfo | null
    }
    
    class usePhotoUpload {
        -files: FileWithPath[]
        -preview: string | null
        -uploadState: UploadState
        -uploadProgress: number
        -locationData: LocationData
        +handleDrop(files) void
        +handleUpload() Promise~void~
        +handleRemove() void
    }
    
    class usePhotoGroups {
        -photos: UploadedPhoto[]
        +groups: PhotoGroup[]
        +getGroups() PhotoGroup[]
    }
    
    class PhotoGroup {
        +representative: UploadedPhoto
        +photos: UploadedPhoto[]
        +isDuplicate: boolean
    }
    
    useUser --> ReduxStore : uses
    usePhotoUpload --> ApiService : uses
    usePhotoUpload --> useUser : uses
    usePhotoGroups --> PhotoGroup : returns
```

### Hook Dependencies

```mermaid
graph TD
    A[useUser] --> B[Redux Store]
    A --> C[API Service]
    
    D[usePhotoUpload] --> A
    D --> C
    D --> E[Location Service]
    
    F[usePhotoGroups] --> G[Photo data]
    
    style A fill:#4dabf7
    style D fill:#51cf66
    style F fill:#ffd43b
```

---

## Component Hierarchy

### Full Component Tree

```mermaid
graph TB
    App[App.tsx]
    
    App --> Provider[Redux Provider]
    App --> AuthProvider[AuthProvider]
    App --> ThemeProvider[ThemeProvider]
    App --> Router[React Router]
    App --> Navigation[Navigation]
    
    Router --> HomePage[HomePage]
    Router --> LoginPage[LoginPage]
    Router --> AboutPage[AboutPage]
    Router --> ContactPage[ContactPage]
    Router --> AdminRecords[AdminTurtleRecordsPage]
    Router --> AdminMatch[AdminTurtleMatchPage]
    Router --> AdminUsers[AdminUserManagementPage]
    
    HomePage --> Dropzone[Mantine Dropzone]
    HomePage --> PreviewCard[PreviewCard]
    HomePage --> usePhotoUpload[usePhotoUpload Hook]
    
    AdminRecords --> PhotoGroupCard[PhotoGroupCard]
    AdminRecords --> PhotoCard[PhotoCard]
    AdminRecords --> usePhotoGroups[usePhotoGroups Hook]
    
    PhotoCard --> PhotoDetailModal[PhotoDetailModal]
    
    Navigation --> useUser[useUser Hook]
    
    style App fill:#4dabf7
    style HomePage fill:#51cf66
    style AdminRecords fill:#ff6b6b
    style Navigation fill:#ffd43b
```

---

## Data Flow Diagrams

### Authentication Flow

```mermaid
flowchart TD
    Start([User visits app]) --> CheckToken{Token exists?}
    CheckToken -->|Yes| AuthProvider[AuthProvider checks token]
    CheckToken -->|No| ShowLogin[Show Login Page]
    
    AuthProvider --> ValidateToken[Validate with API]
    ValidateToken -->|Valid| SetUser[Set user in Redux]
    ValidateToken -->|Invalid| RemoveToken[Remove token]
    RemoveToken --> ShowLogin
    
    SetUser --> LoadApp[Load Application]
    ShowLogin --> UserLogin[User enters credentials]
    UserLogin --> LoginAPI[API Login Request]
    LoginAPI -->|Success| StoreToken[Store token]
    LoginAPI -->|Failure| ShowError[Show error message]
    
    StoreToken --> SetUser
    ShowError --> UserLogin
    
    style Start fill:#4dabf7
    style LoadApp fill:#51cf66
    style ShowError fill:#ff6b6b
```

### Photo Upload Flow

```mermaid
flowchart TD
    Start([User drops file]) --> Validate[Validate file]
    Validate -->|Invalid| ShowError[Show error notification]
    Validate -->|Valid| CreatePreview[Create preview]
    
    CreatePreview --> ShowPreview[Display preview card]
    ShowPreview --> UserClicksUpload[User clicks upload]
    
    UserClicksUpload --> GetLocation[Get GPS location]
    GetLocation -->|Success| HasLocation{Location available?}
    GetLocation -->|Failed| HasLocation
    
    HasLocation -->|Yes| UploadWithLocation[Upload with location]
    HasLocation -->|No| UploadWithoutLocation[Upload without location]
    
    UploadWithLocation --> APIRequest[API Upload Request]
    UploadWithoutLocation --> APIRequest
    
    APIRequest -->|Success| CheckRole{User role?}
    APIRequest -->|Error| ShowUploadError[Show error]
    
    CheckRole -->|Admin| NavigateMatch[Navigate to match page]
    CheckRole -->|Community| ShowSuccess[Show success message]
    
    NavigateMatch --> End([End])
    ShowSuccess --> End
    ShowUploadError --> End
    ShowError --> End
    
    style Start fill:#4dabf7
    style ShowSuccess fill:#51cf66
    style ShowError fill:#ff6b6b
    style ShowUploadError fill:#ff6b6b
```

### State Management Flow

```mermaid
stateDiagram-v2
    [*] --> Initial: App starts
    Initial --> CheckingAuth: AuthProvider mounted
    CheckingAuth --> Authenticated: Valid token
    CheckingAuth --> Unauthenticated: No/invalid token
    
    Unauthenticated --> LoginPage: User navigates to login
    LoginPage --> LoggingIn: User submits credentials
    LoggingIn --> Authenticated: Login success
    LoggingIn --> LoginError: Login failed
    LoginError --> LoginPage: Retry
    
    Authenticated --> HomePage: Navigate to home
    Authenticated --> AdminPage: Navigate to admin (if admin)
    
    HomePage --> Uploading: User uploads photo
    Uploading --> UploadSuccess: Upload complete
    Uploading --> UploadError: Upload failed
    UploadSuccess --> HomePage: Return to home
    UploadError --> HomePage: Show error
    
    AdminPage --> Reviewing: View review queue
    Reviewing --> Approving: Approve match
    Approving --> Reviewing: Continue reviewing
    
    Authenticated --> LoggingOut: User logs out
    LoggingOut --> Unauthenticated: Logout complete
```

---

## File Structure

```
frontend/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── AuthProvider.tsx
│   │   ├── Navigation.tsx
│   │   ├── PhotoCard.tsx
│   │   ├── PhotoDetailModal.tsx
│   │   ├── PhotoGroupCard.tsx
│   │   └── PreviewCard.tsx
│   ├── hooks/               # Custom React hooks
│   │   ├── usePhotoGroups.ts
│   │   ├── usePhotoUpload.tsx
│   │   └── useUser.ts
│   ├── pages/               # Page components
│   │   ├── AboutPage.tsx
│   │   ├── AdminTurtleMatchPage.tsx
│   │   ├── AdminTurtleRecordsPage.tsx
│   │   ├── AdminUserManagementPage.tsx
│   │   ├── ContactPage.tsx
│   │   ├── HomePage.tsx
│   │   └── LoginPage.tsx
│   ├── services/            # API and service layer
│   │   ├── api.ts
│   │   └── geolocation.ts
│   ├── store/               # Redux store
│   │   ├── hooks.ts
│   │   ├── index.ts
│   │   └── slices/
│   │       ├── themeSlice.ts
│   │       └── userSlice.ts
│   ├── types/               # TypeScript type definitions
│   │   ├── User.ts
│   │   └── photo.ts
│   ├── utils/               # Utility functions
│   │   ├── fileValidation.ts
│   │   ├── imageCompression.ts
│   │   └── photoHelpers.ts
│   ├── App.tsx              # Root component
│   ├── main.tsx             # Entry point
│   └── index.css            # Global styles
├── tests/                   # Playwright tests
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Key Design Patterns

### 1. Provider Pattern
- **AuthProvider**: Wraps the app and handles authentication state restoration
- **ThemeProvider**: Provides role-based theming (community/admin)

### 2. Custom Hooks Pattern
- Encapsulates business logic and state management
- Promotes code reusability
- Examples: `useUser`, `usePhotoUpload`, `usePhotoGroups`

### 3. Service Layer Pattern
- Centralized API communication
- Token management
- Error handling

### 4. Redux Slice Pattern
- Modular state management
- Type-safe actions and reducers
- Examples: `userSlice`, `themeSlice`

### 5. Component Composition
- Small, focused components
- Props-based communication
- Reusable UI elements

---

## Summary

The frontend architecture follows modern React best practices with:

- **Clear separation of concerns** between components, hooks, and services
- **Type-safe** implementation with TypeScript
- **Centralized state management** with Redux Toolkit
- **Reusable business logic** through custom hooks
- **Consistent UI** with Mantine component library
- **Role-based theming** for different user types
- **Comprehensive error handling** and user feedback

This architecture ensures maintainability, scalability, and a good developer experience while providing a smooth user experience.

