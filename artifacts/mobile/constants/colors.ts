/**
 * HRMS Command mobile theme — synced with the web artifact's dark
 * command-center branding (dark navy surfaces, amber accents).
 * The app is dark-first: both schemes use the dark palette so the
 * branding stays consistent with the HRMS Command web console.
 */

const command = {
  // Legacy aliases
  text: '#E6EDF7',
  tint: '#F59E0B',

  // Core surfaces
  background: '#0B1220',
  foreground: '#E6EDF7',

  // Cards / elevated surfaces
  card: '#121C2E',
  cardForeground: '#E6EDF7',

  // Primary action color (amber)
  primary: '#F59E0B',
  primaryForeground: '#0F172A',

  // Secondary interactive surfaces
  secondary: '#1B2740',
  secondaryForeground: '#CBD5E1',

  // Muted / subdued
  muted: '#16203A',
  mutedForeground: '#8CA0B8',

  // Accent highlights
  accent: '#1E2A45',
  accentForeground: '#F59E0B',

  // Status colors
  destructive: '#EF4444',
  destructiveForeground: '#FFFFFF',
  success: '#22C55E',
  warning: '#F59E0B',

  // Borders and inputs
  border: '#243350',
  input: '#243350',
};

const colors = {
  light: command,
  dark: command,
  radius: 12,
};

export default colors;
