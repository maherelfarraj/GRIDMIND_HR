import { describe, it, expect } from 'vitest';
import { localName, localFullName } from '../localise';

// ── localName ─────────────────────────────────────────────────────────────────

describe('localName', () => {
  describe('English UI (lang = "en")', () => {
    it('returns the English name', () => {
      expect(localName('Engineering', 'هندسة', 'en')).toBe('Engineering');
    });

    it('returns English even when Arabic is present', () => {
      expect(localName('HR', 'الموارد البشرية', 'en')).toBe('HR');
    });

    it('returns English when Arabic is null', () => {
      expect(localName('Finance', null, 'en')).toBe('Finance');
    });

    it('returns English when Arabic is undefined', () => {
      expect(localName('Finance', undefined, 'en')).toBe('Finance');
    });

    it('returns English when Arabic is an empty string', () => {
      expect(localName('Finance', '', 'en')).toBe('Finance');
    });

    it('returns empty string when English is null', () => {
      expect(localName(null, null, 'en')).toBe('');
    });

    it('returns empty string when English is undefined', () => {
      expect(localName(undefined, undefined, 'en')).toBe('');
    });
  });

  describe('Arabic UI (lang = "ar")', () => {
    it('returns the Arabic name when present', () => {
      expect(localName('Engineering', 'هندسة', 'ar')).toBe('هندسة');
    });

    it('falls back to English when Arabic is null', () => {
      expect(localName('Engineering', null, 'ar')).toBe('Engineering');
    });

    it('falls back to English when Arabic is undefined', () => {
      expect(localName('Engineering', undefined, 'ar')).toBe('Engineering');
    });

    it('falls back to English when Arabic is an empty string', () => {
      expect(localName('Engineering', '', 'ar')).toBe('Engineering');
    });

    it('falls back to empty string when both are null', () => {
      expect(localName(null, null, 'ar')).toBe('');
    });
  });

  describe('unknown / other lang value', () => {
    it('returns English name for an unknown lang code', () => {
      expect(localName('Engineering', 'هندسة', 'fr')).toBe('Engineering');
    });
  });
});

// ── localFullName ─────────────────────────────────────────────────────────────

describe('localFullName', () => {
  const enFirst = 'Ahmed';
  const enLast  = 'Al-Rashidi';
  const arFirst = 'أحمد';
  const arLast  = 'الراشدي';

  describe('English UI (lang = "en")', () => {
    it('returns English full name when Arabic fields exist', () => {
      expect(localFullName(enFirst, enLast, arFirst, arLast, 'en')).toBe('Ahmed Al-Rashidi');
    });

    it('returns English full name when Arabic fields are null', () => {
      expect(localFullName(enFirst, enLast, null, null, 'en')).toBe('Ahmed Al-Rashidi');
    });

    it('returns English full name when Arabic fields are undefined', () => {
      expect(localFullName(enFirst, enLast, undefined, undefined, 'en')).toBe('Ahmed Al-Rashidi');
    });

    it('returns English full name when Arabic fields are empty strings', () => {
      expect(localFullName(enFirst, enLast, '', '', 'en')).toBe('Ahmed Al-Rashidi');
    });
  });

  describe('Arabic UI (lang = "ar")', () => {
    it('returns Arabic full name when both Arabic parts are present', () => {
      expect(localFullName(enFirst, enLast, arFirst, arLast, 'ar')).toBe('أحمد الراشدي');
    });

    it('falls back to English when Arabic first name is missing (null)', () => {
      expect(localFullName(enFirst, enLast, null, arLast, 'ar')).toBe('Ahmed Al-Rashidi');
    });

    it('falls back to English when Arabic first name is missing (empty)', () => {
      expect(localFullName(enFirst, enLast, '', arLast, 'ar')).toBe('Ahmed Al-Rashidi');
    });

    it('falls back to English when Arabic last name is missing (null)', () => {
      expect(localFullName(enFirst, enLast, arFirst, null, 'ar')).toBe('Ahmed Al-Rashidi');
    });

    it('falls back to English when Arabic last name is missing (empty)', () => {
      expect(localFullName(enFirst, enLast, arFirst, '', 'ar')).toBe('Ahmed Al-Rashidi');
    });

    it('falls back to English when both Arabic parts are missing', () => {
      expect(localFullName(enFirst, enLast, null, null, 'ar')).toBe('Ahmed Al-Rashidi');
    });

    it('falls back to English when both Arabic parts are empty strings', () => {
      expect(localFullName(enFirst, enLast, '', '', 'ar')).toBe('Ahmed Al-Rashidi');
    });

    it('falls back to English when both Arabic parts are undefined', () => {
      expect(localFullName(enFirst, enLast, undefined, undefined, 'ar')).toBe('Ahmed Al-Rashidi');
    });
  });

  describe('edge cases', () => {
    it('handles null English parts gracefully (returns empty string)', () => {
      expect(localFullName(null, null, null, null, 'en')).toBe('');
    });

    it('handles undefined English parts gracefully (returns empty string)', () => {
      expect(localFullName(undefined, undefined, undefined, undefined, 'ar')).toBe('');
    });

    it('produces no extra whitespace when only one English part exists', () => {
      // single name (mononym): lastEn null — result should not have a trailing space
      expect(localFullName('Reem', null, '', null, 'en')).toBe('Reem');
    });
  });
});
