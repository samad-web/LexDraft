module.exports = {
  extends: ['./index.cjs', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  settings: { react: { version: 'detect' } },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    // Apostrophes and quotes in JSX text are valid; escaping them
    // (`don&apos;t`) hurts readability without protecting anything.
    'react/no-unescaped-entities': 'off',
  },
};
