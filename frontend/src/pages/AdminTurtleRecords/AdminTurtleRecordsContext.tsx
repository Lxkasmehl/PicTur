import { createContext, useContext, type ReactNode } from 'react';
import type { useAdminTurtleRecords } from '../../hooks/useAdminTurtleRecords';

export type AdminTurtleRecordsContextValue = ReturnType<typeof useAdminTurtleRecords>;

const AdminTurtleRecordsContext = createContext<AdminTurtleRecordsContextValue | null>(
  null,
);

export function AdminTurtleRecordsProvider({
  value,
  children,
}: {
  value: AdminTurtleRecordsContextValue;
  children: ReactNode;
}) {
  return (
    <AdminTurtleRecordsContext.Provider value={value}>
      {children}
    </AdminTurtleRecordsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAdminTurtleRecordsContext(): AdminTurtleRecordsContextValue {
  const ctx = useContext(AdminTurtleRecordsContext);
  if (!ctx) {
    throw new Error(
      'useAdminTurtleRecordsContext must be used within AdminTurtleRecordsProvider',
    );
  }
  return ctx;
}
