/**
 * Alert Store - Zustand store for price alert state management
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { PriceAlert, AlertPreferences } from '@/types';

interface AlertState {
  // Alert state
  alerts: PriceAlert[];
  loading: boolean;
  error: string | null;

  // Alert preferences
  preferences: AlertPreferences;

  // Notification status
  notificationPermission: boolean;
  pushToken: string | null;

  // Actions
  setAlerts: (alerts: PriceAlert[]) => void;
  addAlert: (alert: PriceAlert) => void;
  updateAlert: (id: string, updates: Partial<PriceAlert>) => void;
  removeAlert: (id: string) => void;
  toggleAlert: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Preferences
  setPreferences: (preferences: Partial<AlertPreferences>) => void;
  setNotificationPermission: (granted: boolean) => void;
  setPushToken: (token: string | null) => void;

  // Alert management
  clearAllAlerts: () => void;
  markAlertAsRead: (id: string) => void;
  snoozeAlert: (id: string, minutes: number) => void;
}

export const useAlertStore = create<AlertState>()(
  devtools(
    (set, get) => ({
      // Initial state
      alerts: [],
      loading: false,
      error: null,
      preferences: {
        priceDrops: true,
        dealAlerts: true,
        stockAlerts: true,
        dailyDigest: false,
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00',
        },
      },
      notificationPermission: false,
      pushToken: null,

      // Actions
      setAlerts: (alerts: PriceAlert[]) => {
        set({ alerts });
      },

      addAlert: (alert: PriceAlert) => {
        set((state) => ({
          alerts: [...state.alerts, alert],
        }));
      },

      updateAlert: (id: string, updates: Partial<PriceAlert>) => {
        set((state) => ({
          alerts: state.alerts.map(alert =>
            alert.id === id ? { ...alert, ...updates } : alert
          ),
        }));
      },

      removeAlert: (id: string) => {
        set((state) => ({
          alerts: state.alerts.filter(alert => alert.id !== id),
        }));
      },

      toggleAlert: (id: string) => {
        set((state) => ({
          alerts: state.alerts.map(alert =>
            alert.id === id ? { ...alert, enabled: !alert.enabled } : alert
          ),
        }));
      },

      setLoading: (loading: boolean) => {
        set({ loading });
      },

      setError: (error: string | null) => {
        set({ error });
      },

      setPreferences: (preferences: Partial<AlertPreferences>) => {
        set((state) => ({
          preferences: { ...state.preferences, ...preferences },
        }));
      },

      setNotificationPermission: (granted: boolean) => {
        set({ notificationPermission: granted });
      },

      setPushToken: (token: string | null) => {
        set({ pushToken: token });
      },

      clearAllAlerts: () => {
        set({ alerts: [] });
      },

      markAlertAsRead: (id: string) => {
        set((state) => ({
          alerts: state.alerts.map(alert =>
            alert.id === id ? { ...alert, isRead: true } : alert
          ),
        }));
      },

      snoozeAlert: (id: string, minutes: number) => {
        const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);
        set((state) => ({
          alerts: state.alerts.map(alert =>
            alert.id === id ? { ...alert, snoozeUntil } : alert
          ),
        }));
      },
    }),
    {
      name: 'alert-store',
    }
  )
);