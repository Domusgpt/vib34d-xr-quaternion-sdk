# Contributing to VIB34D XR Quaternion SDK

Thank you for your interest in contributing to the VIB34D XR Quaternion SDK! This document provides guidelines and instructions for contributing.

## 🌟 How to Contribute

There are many ways to contribute to this project:

- 🐛 **Report bugs** - Help us identify and fix issues
- 💡 **Suggest features** - Share ideas for improvements
- 📝 **Improve documentation** - Help others understand the SDK
- 🧪 **Write tests** - Increase code coverage and reliability
- 💻 **Submit code** - Fix bugs or implement new features
- 🎨 **Create examples** - Show how to use the SDK

## 📋 Code of Conduct

This project follows a Code of Conduct to ensure a welcoming environment for all contributors. By participating, you agree to:

- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards others

## 🚀 Getting Started

### Prerequisites

- Node.js 16.x or higher
- Git
- A code editor (VS Code recommended)

### Setting Up Your Development Environment

1. **Fork the repository**

```bash
# Click "Fork" on GitHub, then clone your fork
git clone https://github.com/YOUR-USERNAME/vib34d-xr-quaternion-sdk.git
cd vib34d-xr-quaternion-sdk
```

2. **Install dependencies**

```bash
npm install
```

3. **Run tests to verify setup**

```bash
npm test
```

4. **Start development**

```bash
npm run build:watch  # Watch mode for builds
npm run test:watch   # Watch mode for tests
```

## 🔧 Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

**Branch naming conventions:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `test/` - Test additions/improvements
- `refactor/` - Code refactoring

### 2. Make Your Changes

**Follow these guidelines:**

- Write clear, self-documenting code
- Add comments for complex logic
- Follow existing code style
- Update documentation if needed
- Write tests for new features

### 3. Test Your Changes

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linter
npm run lint

# Run benchmarks
npm run benchmark
```

### 4. Commit Your Changes

We follow conventional commits format:

```bash
git commit -m "feat: add quaternion interpolation"
git commit -m "fix: correct sensor normalization bug"
git commit -m "docs: update API reference"
git commit -m "test: add telemetry provider tests"
```

**Commit types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

### 5. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

## 📝 Pull Request Guidelines

### Before Submitting

- ✅ Tests pass (`npm test`)
- ✅ Build succeeds (`npm run build`)
- ✅ Linter passes (`npm run lint`)
- ✅ Documentation updated (if applicable)
- ✅ Examples added/updated (if applicable)

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## Testing
Describe how you tested your changes

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes
- [ ] Follows code style guidelines

## Related Issues
Closes #123
```

### Review Process

1. **Automated checks** - CI/CD runs tests and builds
2. **Code review** - Maintainers review your code
3. **Feedback** - Address any requested changes
4. **Approval** - Once approved, PR will be merged

## 🧪 Writing Tests

### Test Structure

```javascript
import { describe, it, expect, beforeEach } from 'vitest';

describe('ComponentName', () => {
  describe('methodName', () => {
    it('should do something specific', () => {
      // Arrange
      const input = createTestData();

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe(expectedValue);
    });
  });
});
```

### Test Coverage Goals

- **Unit tests**: 80% coverage minimum
- **Integration tests**: Critical paths covered
- **E2E tests**: Main user flows covered

### Running Specific Tests

```bash
# Run tests matching a pattern
npm test -- --grep "quaternion"

# Run a specific test file
npm test tests/unit/geometry.test.js

# Run with coverage
npm run test:coverage
```

## 📚 Documentation Guidelines

### Code Comments

```javascript
/**
 * Normalizes a quaternion to unit length
 * @param {Object} quaternion - Input quaternion {x, y, z, w}
 * @returns {Object} Normalized quaternion
 */
function normalizeQuaternion(quaternion) {
  // Implementation
}
```

### README Updates

- Keep examples concise and clear
- Update table of contents if adding sections
- Use proper markdown formatting

### API Documentation

- Document all public methods
- Include parameter types and descriptions
- Provide usage examples
- Note any breaking changes

## 🎨 Code Style

### JavaScript Style Guide

```javascript
// Good
function calculateMagnitude(vector) {
  return Math.sqrt(
    vector.x ** 2 +
    vector.y ** 2 +
    vector.z ** 2 +
    vector.w ** 2
  );
}

// Avoid
function calc_mag(v){return Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z+v.w*v.w)}
```

**Key principles:**
- Use ES6+ features
- Prefer `const` over `let`
- Use descriptive variable names
- Keep functions small and focused
- Avoid deep nesting

### Formatting

We use Prettier for consistent formatting:

```bash
npm run format
```

### Linting

We use ESLint for code quality:

```bash
npm run lint
```

## 🐛 Reporting Bugs

### Before Reporting

1. Check existing issues
2. Verify it's not a known issue
3. Test with latest version

### Bug Report Template

```markdown
**Description**
Clear description of the bug

**Steps to Reproduce**
1. Step one
2. Step two
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- SDK Version: 1.0.0
- Browser: Chrome 120
- OS: Windows 11
- Device: Desktop

**Additional Context**
Screenshots, error logs, etc.
```

## 💡 Suggesting Features

### Feature Request Template

```markdown
**Feature Description**
Clear description of the feature

**Use Case**
Why is this feature needed?

**Proposed Solution**
How should it work?

**Alternatives Considered**
Other approaches you've thought about

**Additional Context**
Any other relevant information
```

## 🏗️ Project Structure

```
vib34d-xr-quaternion-sdk/
├── src/                    # Source code
│   ├── core/              # Core SDK systems
│   ├── ui/adaptive/       # XR & sensor integration
│   ├── product/           # Commercial features
│   ├── geometry/          # 4D mathematics
│   └── ...
├── tests/                 # Test files
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── benchmarks/       # Performance benchmarks
├── examples/             # Example applications
├── DOCS/                 # Documentation
└── types/                # TypeScript definitions
```

## 📦 Release Process

Releases are handled by maintainers:

1. Version bump (semantic versioning)
2. Update CHANGELOG
3. Create GitHub release
4. Publish to npm

## 🤝 Community

- **GitHub Discussions** - Ask questions, share ideas
- **GitHub Issues** - Report bugs, request features
- **Email** - Paul@clearseassolutions.com

## 📄 License

By contributing, you agree that your contributions will be licensed under the same license as the project.

See `DOCS/LICENSE_ATTESTATION_PROFILE_CATALOG.md` for details.

## 🙏 Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes
- Project documentation

Thank you for contributing to VIB34D XR Quaternion SDK! 🎉

---

**Questions?** Don't hesitate to ask in GitHub Discussions or reach out to the maintainers.
