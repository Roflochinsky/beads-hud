import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

// Pinned warm-monochrome design-reference tokens. Native font registration belongs to Paseo.
export const colors = { ground: "#fdfbfa", surface: "#ffffff", wash: "#f6f3ef", ink: "#27251e", muted: "#6a6860", accent: "#271a00", line: "rgba(39,26,0,0.2)" };
export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  content: { padding: 16, gap: 16 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  text: { fontSize: 14, lineHeight: 20, color: colors.ink },
  heading: { fontSize: 16, lineHeight: 24, fontWeight: "500", color: colors.ink },
  caption: { fontSize: 12, lineHeight: 16, color: colors.muted },
  input: { borderWidth: 1, borderColor: colors.muted, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, minHeight: 44, color: colors.ink, backgroundColor: colors.surface, fontSize: 14 },
  section: { gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.line },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 12, gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, justifyContent: "center", backgroundColor: colors.wash },
  notice: { padding: 12, backgroundColor: colors.wash, borderRadius: 6 },
});

export function Button({ children, onPress, disabled = false, selected = false, primary = false }: {
  children: string; onPress(): void; disabled?: boolean; selected?: boolean; primary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={children} accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button,
      (primary || selected) && { backgroundColor: colors.accent }, { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }]}>
    <Text style={[styles.text, (primary || selected) && { color: colors.ground }]}>{children}</Text>
  </Pressable>;
}

export function Field({ label, value, onChange, multiline = false, disabled = false }: {
  label: string; value: string; onChange(value: string): void; multiline?: boolean; disabled?: boolean;
}) {
  return <View style={{ gap: 4 }}><Text style={styles.caption}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline}
      editable={!disabled} style={[styles.input, multiline && { minHeight: 88, textAlignVertical: "top" }]} />
  </View>;
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <View style={styles.notice}><Text accessibilityRole={error ? "alert" : undefined} accessibilityLiveRegion="polite" style={styles.text}>{children}</Text></View>;
}

export function Choices({ label, value, choices, onChange, disabled = false }: {
  label: string; value: string; choices: readonly string[]; onChange(value: string): void; disabled?: boolean;
}) {
  return <View style={{ gap: 4 }}><Text style={styles.caption}>{label}</Text><View style={styles.row}>
    {choices.map((choice) => <Button key={choice} selected={choice === value} disabled={disabled} onPress={() => onChange(choice)}>{choice}</Button>)}
  </View></View>;
}
