import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import vm from 'node:vm';
import { transformSync } from '@babel/core';
import { darkColors, lightColors } from '../src/theme/colors.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/components/AboutYouForm.tsx', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  filename: 'AboutYouForm.tsx', configFile: false, babelrc: false,
  plugins: [[require.resolve('@babel/plugin-transform-typescript'), { isTSX: true }], require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
});
function luminance(hex) {
  const channels = hex.match(/[a-f0-9]{2}/gi).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + 0.05) / (values[1] + 0.05); }
function flatten(style) { return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style; }
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.children)];
}
function render(colors, initialValue) {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children });
  const react = { __esModule: true, default: { createElement }, useEffect() {}, useState: (initial) => [initial, () => {}] };
  const native = Object.fromEntries(['Pressable', 'ScrollView', 'Switch', 'Text', 'TextInput', 'View'].map((type) => [type, type]));
  native.StyleSheet = { create: (styles) => styles };
  const prefs = { gender: null, genderDescription: '', showGenderOnProfile: false, meeting: [] };
  const imports = {
    react, 'react-native': native, '@expo/vector-icons': { Ionicons: 'Ionicons' }, '@/components/Button': { Button: 'Button' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) },
    '@/theme/colors': { radii: { md: 12, lg: 14 } },
    '@/context/AppearanceContext': { useTheme: () => ({ colors, isDark: colors === darkColors }), useThemedStyles: (factory) => factory(colors) },
    '@/services/aboutYouPreferences': { emptyAboutYouPreferences: () => ({ ...prefs }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, module, require: (name) => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; } });
  return module.exports.AboutYouForm({ initialValue: { ...prefs, ...initialValue }, submitLabel: 'Continue', onSave() {} });
}
for (const [name, colors] of [['light', lightColors], ['dark', darkColors]]) {
  for (const selected of [false, true]) test(`${name} choices remain readable ${selected ? 'after' : 'before'} selection`, () => {
    const tree = render(colors, selected ? { gender: 'Man', meeting: ['Men'] } : {});
    const choices = elements(tree).filter((node) => node.props.accessibilityRole === 'radio' || node.props.accessibilityRole === 'checkbox');
    assert.equal(choices.length, 9);
    for (const choice of choices) {
      const background = flatten(choice.props.style).backgroundColor;
      const labels = elements(choice.children).filter((node) => node.type === 'Text');
      for (const label of labels) {
        const ratio = contrast(flatten(label.props.style).color, background);
        assert.ok(ratio >= 4.5, `${name} label ${label.children.join('')} has insufficient contrast: ${ratio.toFixed(2)}:1`);
      }
      assert.ok(flatten(choice.props.style).minHeight >= 44);
    }
  });
}
