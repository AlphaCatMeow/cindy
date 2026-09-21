import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SharedTaskListItem } from '@cindy/device-link';
import { Text } from '@/components/AppText';
import { MainWindowRowButton } from '@/components/MobilePrimitives';
import { useThemedStyles, type ThemeColors } from '@/theme';
import { fontWeight, spacing, typeScale } from '@/theme/tokens';

/** Account-level shortcuts remain visible even before a device link is allowed. */
export function OwnedSharedTasks({ tasks, onSelect }: {
  tasks: readonly SharedTaskListItem[];
  onSelect(task: SharedTaskListItem): void;
}) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  if (!tasks.length) return null;
  return <View style={styles.section}>
    <Text style={styles.heading}>{t('sharedTask.ownedTitle')}</Text>
    {tasks.map(task => <MainWindowRowButton key={task.sharedTaskId} accessibilityLabel={task.title} onPress={() => onSelect(task)}>
      <Text style={styles.title}>{task.title}</Text>
    </MainWindowRowButton>)}
  </View>;
}
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  section: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  heading: { color: colors.textTertiary, fontSize: typeScale.caption, marginBottom: spacing.sm },
  title: { color: colors.textPrimary, fontSize: typeScale.footnote, fontWeight: fontWeight.medium, flexShrink: 1 },
});
