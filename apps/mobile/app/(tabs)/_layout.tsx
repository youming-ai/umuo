import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { useUser } from '@/store/user_store';

export default function TabLayout() {
  const { colors } = useTheme();
  const user = useUser();
  const userPreferences = user?.preferences?.display;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.gray[400],
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'ホーム',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon
              focused={focused}
              color={color}
              size={size}
              name="home"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="compare"
        options={{
          title: '比較',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon
              focused={focused}
              color={color}
              size={size}
              name="compare"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="deals"
        options={{
          title: 'お得',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon
              focused={focused}
              color={color}
              size={size}
              name="tag"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'アラート',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon
              focused={focused}
              color={color}
              size={size}
              name="bell"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'プロフィール',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon
              focused={focused}
              color={color}
              size={size}
              name="user"
            />
          ),
        }}
      />
    </Tabs>
  );
}

// Simple icon component - in a real app, you'd use expo/vector-icons
function TabIcon({ focused, color, size, name }: {
  focused: boolean;
  color: string;
  size: number;
  name: string;
}) {
  const iconMap: Record<string, string> = {
    home: focused ? '🏠' : '🏠',
    compare: focused ? '📊' : '📊',
    tag: focused ? '🏷️' : '🏷️',
    bell: focused? '🔔' : '🔔',
    user: focused? '👤' : '👤',
  };

  return (
    <Text
      style={{
        fontSize: size,
        color: color,
        marginBottom: -3,
      }}
    >
      {iconMap[name] || '❓'}
    </Text>
  );
}