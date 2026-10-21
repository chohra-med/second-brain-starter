# Tool pack: Expo

<!-- rule-layer: tool -->
<!-- pack: tool-expo -->
<!-- applies: expo >=50 -->

- **EXPO-01** Add or update an Expo-managed library with `npx expo install` so its version matches the project's SDK. (source: Expo documentation, Using libraries, https://docs.expo.dev/workflow/using-libraries/)
- **EXPO-02** Check a library's platform compatibility on its Expo reference page before adopting it. (source: Expo documentation, Using libraries, https://docs.expo.dev/workflow/using-libraries/)
- **EXPO-03** Never put a secret in an `EXPO_PUBLIC_` variable, because its value ships in the app bundle in plain text. (source: Expo documentation, Environment variables, https://docs.expo.dev/guides/environment-variables/)
