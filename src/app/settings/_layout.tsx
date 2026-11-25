import { Stack } from 'expo-router';

import { largeTitleStack } from '@/ui/stackOptions';

export default function TabStackLayout() {
  return <Stack screenOptions={largeTitleStack} />;
}
