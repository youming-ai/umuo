import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { MMKV } from 'react-native-mmkv';
import SecureStore from 'expo-secure-store';
import { User, UserPreferences } from '@/types/user';

interface UserState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  login: (userData: Partial<User>) => void;
  logout: () => void;
  updateUser: (userData: Partial<User>) => void;
  updatePreferences: (preferences: Partial<UserPreferences>) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const storage = createJSONStorage(() => MMKV);

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      error: null,

      login: async (userData: Partial<User>) => {
        set({ isLoading: true, error: null });

        try {
          // In a real app, this would make an API call
          // const response = await apiClient.post('/auth/login', userData);

          const newUser: User = {
            id: userData.id || crypto.randomUUID(),
            email: userData.email || '',
            displayName: userData.displayName || '',
            avatar: userData.avatar,
            language: userData.language || 'ja',
            currency: userData.currency || 'JPY',
            timezone: 'Asia/Tokyo',
            preferences: userData.preferences || {
              notifications: {
                priceAlerts: true,
                dealAlerts: true,
                communityUpdates: false,
                marketingEmails: false,
              },
              privacy: {
                analyticsEnabled: true,
                personalizationEnabled: true,
                locationTracking: false,
                affiliateDisclosure: true,
              },
              search: {
                preferredCategories: [],
                priceSensitivity: 'medium',
                showExpired: false,
              },
              display: {
                language: userData.language || 'ja',
                currency: 'JPY',
                theme: 'auto',
              },
            },
            subscription: userData.subscription,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastActiveAt: new Date(),
          };

          // Store auth tokens securely
          if (userData.accessToken) {
            await SecureStore.setItemAsync('accessToken', userData.accessToken);
          }
          if (userData.refreshToken) {
            await SecureStore.setItemAsync('refreshToken', userData.refreshToken);
          }

          set({
            user: newUser,
            isAuthenticated: true,
            isLoading: false
          });
        } catch (error) {
          set({
            error: 'Login failed',
            isLoading: false
          });
        }
      },

      logout: async () => {
        set({ isLoading: true });

        try {
          // Clear secure storage
          await SecureStore.deleteItemAsync('accessToken');
          await SecureStore.deleteItemAsync('refreshToken');

          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null
          });
        } catch (error) {
          set({
            isLoading: false,
            error: 'Logout failed'
          });
        }
      },

      updateUser: (userData: Partial<User>) => {
        const currentUser = get().user;
        if (!currentUser) return;

        const updatedUser = {
          ...currentUser,
          ...userData,
          updatedAt: new Date(),
          lastActiveAt: new Date(),
        };

        set({ user: updatedUser });
      },

      updatePreferences: (preferences: Partial<UserPreferences>) => {
        const currentUser = get().user;
        if (!currentUser) return;

        const updatedPreferences = {
          ...currentUser.preferences,
          ...preferences,
        };

        const updatedUser = {
          ...currentUser,
          preferences: updatedPreferences,
          updatedAt: new Date(),
          lastActiveAt: new Date(),
        };

        set({ user: updatedUser });
      },

      setLoading: (isLoading: boolean) => {
        set({ isLoading });
      },

      setError: (error: string | null) => {
        set({ error });
      },
    }),
    {
      name: 'user-store',
      storage,
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Selectors
export const useUser = () => useUserStore(state => state.user);
export const useAuthState = () => useUserStore(state => ({
  isAuthenticated: state.isAuthenticated,
  isLoading: state.isLoading,
  error: state.error,
}));
export const useUserPreferences = () => useUserStore(state => state.user?.preferences);
export const useSubscription = () => useUserStore(state => state.user?.subscription);

// Actions
export const { login, logout, updateUser, updatePreferences, setLoading, setError } = useUserStore.getState();