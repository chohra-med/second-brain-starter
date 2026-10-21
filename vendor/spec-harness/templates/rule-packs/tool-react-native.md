# Tool pack: React Native

<!-- rule-layer: tool -->
<!-- pack: tool-react-native -->
<!-- applies: react-native >=0.70 -->

- **RN-01** Give every list a `keyExtractor` that returns a stable key for each item. (source: React Native documentation, Optimizing FlatList configuration, https://reactnative.dev/docs/optimizing-flatlist-configuration)
- **RN-02** Keep list item components light and wrap them in `React.memo` when their props are stable. (source: React Native documentation, Optimizing FlatList configuration, https://reactnative.dev/docs/optimizing-flatlist-configuration)
- **RN-03** Provide `getItemLayout` when every row of a list has the same fixed height. (source: React Native documentation, Optimizing FlatList configuration, https://reactnative.dev/docs/optimizing-flatlist-configuration)
- **RN-04** Set an `accessibilityLabel` on every touchable element whose purpose its text does not already state. (source: React Native documentation, Accessibility, https://reactnative.dev/docs/accessibility)
- **RN-05** Judge JavaScript performance on a release build, because development mode runs slower. (source: React Native documentation, Performance overview, https://reactnative.dev/docs/0.77/performance)
