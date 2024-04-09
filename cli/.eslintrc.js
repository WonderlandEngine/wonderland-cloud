module.exports = {
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript"
  ],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint/eslint-plugin", "jest"],
  rules: {
    "import/prefer-default-export": "off",
    "import/no-cycle": "off",
    "no-multi-assign": "off",
    "no-async-promise-executor": "off",
    "no-useless-catch": "off",
    "no-shadow": ["error", { "allow": ["Request", "Error"] }],
    "prefer-const": "error",
    "@typescript-eslint/no-explicit-any": ["off"],
    "no-throw-literal": "error",
    "import/no-anonymous-default-export": ["warn", { "allowObject": true }],
    "no-case-declarations": "off",
    "max-params": "off",
    "jest/no-disabled-tests": "warn",
    "jest/no-focused-tests": "error",
    "jest/no-identical-title": "error",
    "jest/prefer-to-have-length": "warn",
    "jest/valid-expect": "error"
  },
  env: {
    node: true,
    "jest/globals": true

  }
};
