# Tool pack: Sentry for React Native

<!-- rule-layer: tool -->
<!-- pack: tool-sentry -->
<!-- applies: @sentry/react-native >=5.11.0 -->

- **SENTRY-01** Remove personal data and credentials in `beforeSend` and `beforeSendTransaction` before an event leaves the app. (source: Sentry documentation, React Native sensitive data, https://docs.sentry.io/platforms/react-native/guides/expo/data-management/sensitive-data/)
- **SENTRY-02** Agree on which data may be sent to Sentry, record it as a decision and enforce it in code review. (source: Sentry documentation, React Native sensitive data, https://docs.sentry.io/platforms/react-native/guides/expo/data-management/sensitive-data/)
- **SENTRY-03** Upload source maps for every release build so that reported stack traces point to the original source. (source: Sentry documentation, React Native source maps, https://docs.sentry.io/platforms/react-native/sourcemaps/)
- **SENTRY-04** Keep the Sentry auth token in a build secret and never in client code. (source: Expo documentation, Environment variables in EAS, https://docs.expo.dev/eas/using-environment-variables)
