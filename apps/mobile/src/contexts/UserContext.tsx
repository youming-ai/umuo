import React, { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useUserStore } from '@/store/user_store';

interface UserContextType {
  user: ReturnType<typeof useUserStore>['user'];
  isAuthenticated: ReturnType<typeof useUserStore>['isAuthenticated'];
  isLoading: ReturnType<typeof useUserStore>['isLoading'];
  login: ReturnType<typeof useUserStore>['login'];
  logout: ReturnType<typeof useUserStore>['logout'];
  updateUser: ReturnType<typeof useUserStore>['updateUser'];
  updatePreferences: ReturnType<typeof useUserStore>['updatePreferences'];
}

const UserContext = createContext<UserContextType | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const userStore = useUserStore();

  const contextValue: UserContextType = {
    user: userStore.user,
    isAuthenticated: userStore.isAuthenticated,
    isLoading: userStore.isLoading,
    login: userStore.login,
    logout: userStore.logout,
    updateUser: userStore.updateUser,
    updatePreferences: userStore.updatePreferences,
  };

  return (
    <UserContext.Provider value={contextValue}>
      {children}
    </UserContext.Provider>
  );
}

export function useUserContext() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUserContext must be used within a UserProvider');
  }
  return context;
}