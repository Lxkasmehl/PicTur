# UML Diagrams for Frontend

This document contains detailed UML diagrams for major components and classes. Team members can use these as references when creating their own diagrams.

## 1. Component Class Diagram - Detailed

```mermaid
classDiagram
    class App {
        -store: Store
        -children: ReactNode
        +render() JSX.Element
    }
    
    class AuthProvider {
        -dispatch: AppDispatch
        -children: ReactNode
        +checkAuth() Promise~void~
        +useEffect() void
    }
    
    class Navigation {
        -navigate: NavigateFunction
        -location: Location
        -opened: boolean
        -user: UserInfo | null
        +children: ReactNode
        +handleLogout() Promise~void~
        +toggleDrawer() void
        +render() JSX.Element
    }
    
    class HomePage {
        -role: UserRole
        -usePhotoUpload: UsePhotoUploadReturn
        +handleDrop(acceptedFiles) void
        +handleReject(rejectedFiles) void
        +render() JSX.Element
    }
    
    class LoginPage {
        -mode: 'login' | 'signup'
        -email: string
        -password: string
        -loading: boolean
        -error: string | null
        +handleLogin() Promise~void~
        +handleRegister() Promise~void~
        +handleGoogleAuth() void
        +render() JSX.Element
    }
    
    class PhotoCard {
        -photo: UploadedPhoto
        -onPhotoClick: function
        -showViewAllButton: boolean
        -totalPhotos: number
        +render() JSX.Element
    }
    
    class PhotoDetailModal {
        -opened: boolean
        -photo: UploadedPhoto | null
        -onClose() void
        +render() JSX.Element
    }
    
    class PreviewCard {
        -preview: string | null
        -uploadState: UploadState
        -uploadProgress: number
        -uploadResponse: string | null
        -locationData: LocationData
        -onUpload() void
        -onRemove() void
        +render() JSX.Element
    }
    
    App --> AuthProvider : contains
    App --> Navigation : contains
    Navigation --> HomePage : navigates to
    Navigation --> LoginPage : navigates to
    HomePage --> PreviewCard : contains
    HomePage --> PhotoCard : contains
    PhotoCard --> PhotoDetailModal : opens
```

## 2. Redux State Management - Detailed

```mermaid
classDiagram
    class Store {
        +user: UserState
        +theme: ThemeState
        +getState() RootState
        +dispatch(action) void
        +subscribe(listener) Unsubscribe
    }
    
    class UserSlice {
        -initialState: UserState
        +setRole(role: UserRole) Action
        +setIsLoggedIn(isLoggedIn: boolean) Action
        +setUser(user: UserInfo) Action
        +login(user: UserInfo) Action
        +logout() Action
    }
    
    class ThemeSlice {
        -initialState: ThemeState
        +setThemeType(type: 'community' | 'admin') Action
    }
    
    class UserState {
        +role: UserRole
        +isLoggedIn: boolean
        +user: UserInfo | null
    }
    
    class ThemeState {
        +themeType: 'community' | 'admin'
    }
    
    class UserInfo {
        +id: number
        +email: string
        +name: string | null
        +role: UserRole
    }
    
    Store --> UserSlice : uses
    Store --> ThemeSlice : uses
    UserSlice --> UserState : manages
    ThemeSlice --> ThemeState : manages
    UserState --> UserInfo : contains
```

## 3. Custom Hooks - Detailed

```mermaid
classDiagram
    class useUser {
        -dispatch: AppDispatch
        -user: UserInfo | null
        -role: UserRole
        -isLoggedIn: boolean
        +login(email: string, password: string) Promise~void~
        +register(data: RegisterRequest) Promise~void~
        +logout() Promise~void~
        +getUser() UserInfo | null
        +getRole() UserRole
        +getIsLoggedIn() boolean
    }
    
    class usePhotoUpload {
        -files: FileWithPath[]
        -preview: string | null
        -uploadState: UploadState
        -uploadProgress: number
        -uploadResponse: string | null
        -imageId: string | null
        -isDuplicate: boolean
        -locationData: LocationData
        -progressIntervalRef: Ref
        +handleDrop(acceptedFiles: FileWithPath[]) void
        +handleUpload() Promise~void~
        +handleRemove() void
        +setLocationData(data: LocationData) void
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
    
    class UploadedPhoto {
        +imageId: string
        +fileName: string
        +fileSize: number
        +uploadDate: string
        +timestamp: number
        +preview: string
        +location: LocationData | null
    }
    
    useUser --> UserInfo : returns
    usePhotoUpload --> UploadedPhoto : manages
    usePhotoGroups --> PhotoGroup : returns
    PhotoGroup --> UploadedPhoto : contains
```

## 4. API Service Layer - Detailed

```mermaid
classDiagram
    class ApiService {
        <<abstract>>
        +AUTH_API_BASE_URL: string
        +TURTLE_API_BASE_URL: string
        +getToken() string | null
        +setToken(token: string) void
        +removeToken() void
        +apiRequest(endpoint: string, options: RequestInit) Promise~Response~
    }
    
    class AuthService {
        +login(data: LoginRequest) Promise~AuthResponse~
        +register(data: RegisterRequest) Promise~AuthResponse~
        +getCurrentUser() Promise~User~
        +logout() Promise~void~
        +getGoogleAuthUrl() string
        +getInvitationDetails(token: string) Promise~InvitationDetails~
        +promoteToAdmin(email: string) Promise~PromoteToAdminResponse~
    }
    
    class TurtleService {
        +uploadTurtlePhoto(file: File, role: string, email: string, location?: LocationData) Promise~UploadPhotoResponse~
        +getReviewQueue() Promise~ReviewQueueResponse~
        +approveReview(requestId: string, data: ApproveReviewRequest) Promise~ApproveReviewResponse~
        +getImageUrl(imagePath: string) string
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
    
    class TurtleMatch {
        +turtle_id: string
        +location: string
        +score: number
        +confidence: number
        +file_path: string
        +filename: string
    }
    
    ApiService <|-- AuthService
    ApiService <|-- TurtleService
    AuthService --> User
    AuthService --> AuthResponse
    TurtleService --> UploadPhotoResponse
    UploadPhotoResponse --> TurtleMatch
```

## 5. Component Interaction Sequence

```mermaid
sequenceDiagram
    participant User
    participant HomePage
    participant usePhotoUpload
    participant PreviewCard
    participant ApiService
    participant Backend
    
    User->>HomePage: Drops photo file
    HomePage->>usePhotoUpload: handleDrop(files)
    usePhotoUpload->>usePhotoUpload: Validate file
    usePhotoUpload->>usePhotoUpload: Create preview
    usePhotoUpload-->>HomePage: Update state
    HomePage->>PreviewCard: Render preview
    
    User->>PreviewCard: Clicks upload button
    PreviewCard->>usePhotoUpload: handleUpload()
    usePhotoUpload->>usePhotoUpload: Get location
    usePhotoUpload->>ApiService: uploadTurtlePhoto(file, role, email, location)
    ApiService->>Backend: POST /api/upload
    Backend-->>ApiService: UploadPhotoResponse
    ApiService-->>usePhotoUpload: Response
    
    alt Admin user
        usePhotoUpload->>usePhotoUpload: Navigate to match page
    else Community user
        usePhotoUpload->>PreviewCard: Show success message
    end
    
    usePhotoUpload-->>HomePage: Update UI
```

## 6. Authentication Flow Sequence

```mermaid
sequenceDiagram
    participant User
    participant LoginPage
    participant useUser
    participant ApiService
    participant AuthBackend
    participant ReduxStore
    participant App
    
    User->>LoginPage: Enters credentials
    User->>LoginPage: Clicks login
    LoginPage->>useUser: login(email, password)
    useUser->>ApiService: login(data)
    ApiService->>AuthBackend: POST /api/auth/login
    AuthBackend-->>ApiService: {token, user}
    ApiService->>ApiService: setToken(token)
    ApiService-->>useUser: AuthResponse
    useUser->>ReduxStore: dispatch(login(user))
    ReduxStore->>ReduxStore: Update state
    ReduxStore-->>App: State changed
    App-->>User: Navigate to home
```

## 7. State Management Flow

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated
    
    Unauthenticated --> LoggingIn: User submits login
    LoggingIn --> Authenticated: Success
    LoggingIn --> LoginError: Failure
    LoginError --> Unauthenticated: Retry
    
    Authenticated --> Browsing: Navigate
    Browsing --> Uploading: Upload photo
    Uploading --> UploadSuccess: Success
    Uploading --> UploadError: Failure
    UploadSuccess --> Browsing: Continue
    UploadError --> Browsing: Retry
    
    Authenticated --> LoggingOut: User logs out
    LoggingOut --> Unauthenticated: Complete
    
    note right of Authenticated
        User state in Redux:
        - isLoggedIn: true
        - user: UserInfo
        - role: 'admin' | 'community'
    end note
```

## 8. Component Dependency Graph

```mermaid
graph TB
    subgraph "Core"
        A[App.tsx]
        B[AuthProvider]
        C[ThemeProvider]
        D[Redux Store]
    end
    
    subgraph "Pages"
        E[HomePage]
        F[LoginPage]
        G[AdminTurtleRecordsPage]
        H[AdminTurtleMatchPage]
    end
    
    subgraph "Components"
        I[PhotoCard]
        J[PreviewCard]
        K[Navigation]
        L[PhotoDetailModal]
    end
    
    subgraph "Hooks"
        M[useUser]
        N[usePhotoUpload]
        O[usePhotoGroups]
    end
    
    subgraph "Services"
        P[API Service]
        Q[Geolocation]
    end
    
    A --> B
    A --> C
    A --> D
    A --> K
    
    E --> N
    E --> J
    F --> M
    G --> I
    G --> O
    H --> I
    
    I --> L
    K --> M
    
    M --> D
    M --> P
    N --> M
    N --> P
    O --> Q
    
    style A fill:#4dabf7
    style D fill:#ff6b6b
    style P fill:#51cf66
```

---

## Diagram Creation Guidelines

When creating your own diagrams, consider:

1. **Class Diagrams**: Focus on relationships, properties, and methods
2. **Sequence Diagrams**: Show the flow of interactions over time
3. **State Diagrams**: Represent state transitions and conditions
4. **Component Diagrams**: Show component hierarchy and dependencies
5. **Use Mermaid syntax**: All diagrams use Mermaid for easy rendering in Markdown

### Tools for Creating Diagrams

- **Mermaid Live Editor**: https://mermaid.live/
- **Draw.io**: https://app.diagrams.net/
- **PlantUML**: https://plantuml.com/
- **Lucidchart**: https://www.lucidchart.com/

### Best Practices

1. Keep diagrams focused on one aspect
2. Use consistent naming conventions
3. Show only relevant relationships
4. Include notes for complex flows
5. Update diagrams when code changes

