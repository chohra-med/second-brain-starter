# Conventions

- Money is stored as an integer count of minor units (cents). Field names end in `Minor`, for example `totalMinor`.
- Floating-point numbers never represent money. Convert to a display string only at the edge of the UI.
