import { TextStyle } from 'react-native';

export const fontFamilies = {
  display: 'Nunito_700Bold',
  displayBlack: 'Nunito_800ExtraBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
} as const;

export const typography = {
  hero: {
    fontFamily: fontFamilies.displayBlack,
    fontSize: 32,
    lineHeight: 40,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 24,
    lineHeight: 32,
  },
  subtitle: {
    fontFamily: fontFamilies.display,
    fontSize: 18,
    lineHeight: 26,
  },
  body: {
    fontFamily: fontFamilies.body,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyMedium: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 16,
    lineHeight: 24,
  },
  small: {
    fontFamily: fontFamilies.body,
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.5,
  },
  button: {
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
} satisfies Record<string, TextStyle>;
