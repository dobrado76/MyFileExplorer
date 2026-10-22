# Task: Generate a Comprehensive AI-Ready Project Documentation System

## Primary objective

Analyse this entire software project and create a comprehensive, accurate, self-contained documentation file named:

`AI-SUPPORT.md`

**The primary purpose of this document is to enable any capable AI assistant (ChatGPT, Claude, Gemini, local LLMs, etc.) to answer virtually any reasonable question about this project without requiring the user to contact the developer.**

Treat this as a permanent, authoritative knowledge base for AI-assisted user support, not merely a README, quick-start guide, API overview, or marketing document.

The desired outcome is simple:

**A user should be able to download `AI-SUPPORT.md`, provide it to their preferred AI assistant, ask questions about this software, and receive accurate, complete, actionable answers based on the documentation alone.**

The file should provide sufficient information for installation, configuration, day-to-day usage, advanced functionality, troubleshooting, technical behaviour, limitations, recovery procedures, and development questions.

The goal is to minimise repetitive support requests to the developer.

Do not optimise for brevity. Optimise for **coverage, accuracy, clarity, self-sufficiency, and AI retrieval reliability**.

However, do not add unnecessary verbosity, invented details, or documentation for functionality that the project does not actually provide.

---

## 1. Investigate the entire project before writing

Perform a systematic examination of the repository.

Do not generate documentation based solely on the README, package metadata, or existing documentation.

Inspect all relevant sources of truth, including where applicable:

- Project structure and source files.
- Application entry points.
- User interfaces, menus, commands, dialogs, settings, and controls.
- Public APIs, CLI commands, services, and integrations.
- Configuration files, defaults, environment variables, and feature flags.
- Data models, schemas, storage locations, and persistence mechanisms.
- Installation scripts, build scripts, and packaging configurations.
- External dependencies and their roles.
- Authentication, permissions, networking, and security boundaries.
- Error handling, diagnostic messages, warnings, and validation.
- Background tasks, queues, concurrency, and cancellation behaviour.
- File operations, database operations, migrations, backups, and recovery.
- Tests and test fixtures.
- Existing documentation, changelogs, and release notes.
- Platform-specific behaviour and limitations.

Identify how the software actually behaves, not merely how it was intended to behave.

**Source code and tests take precedence over outdated or contradictory documentation.**

When behaviour is ambiguous, inspect the implementation and relevant tests before documenting it.

Do not invent behaviour to fill gaps.

If something cannot be determined with reasonable confidence, explicitly identify it as unverified rather than presenting an assumption as fact.

### Evidence and uncertainty

For every significant technical claim, establish its basis using the implementation, tests, verified configuration, or reliable existing documentation.

During generation, maintain an internal evidence map linking important features, configuration defaults, user-facing errors, and troubleshooting claims to their relevant source files or tests. This map can be a separate maintainer artifact; do not clutter the end-user guide with citations for every routine instruction.

Clearly distinguish:

- Verified implemented behaviour.
- Behaviour delegated to or dependent on external software.
- Platform- or version-specific behaviour.
- Known limitations.
- Unverified or undocumented behaviour.

Do not turn plausible assumptions into facts. If tests contradict implementation, investigate actual behaviour where feasible instead of assuming either source is necessarily correct.

## 2. Create a structured documentation system

Prefer the following repository structure, adapting it to the actual project. `AI-SUPPORT.md` belongs at the **repository root**, while the individual source documents remain under `docs/`:

```text
project/
├── README.md
├── AI-SUPPORT.md
├── llms.txt                  # Optional discovery pointer
├── docs/
│   ├── README.md
│   ├── product.md
│   ├── getting-started.md
│   ├── user-guide.md
│   ├── configuration.md
│   ├── reference.md
│   ├── troubleshooting.md
│   ├── architecture.md
│   ├── development.md
│   ├── FAQ.md
│   └── roadmap.md
└── src/                      # Example; adapt to the project
```

The individual `docs/` filenames are suggestions, not mandatory requirements. Keep the consolidated support file at the root as `AI-SUPPORT.md`.

Do not create empty or artificial sections for subjects that do not apply to the project.

Preserve and improve existing documentation rather than unnecessarily replacing it.

Avoid destructive restructuring when the existing organisation is already appropriate.

### Documentation responsibilities

**Root README.md (project entry point)**

Preserve its existing project introduction and add a prominent, user-facing **AI-assisted help** section near the top. This is a **mandatory deliverable**, not merely an optional documentation index. Follow the requirements below.

**docs/README.md (documentation index, if applicable)**

Explain how the documentation is organised and where readers should start, without substituting this index for the AI-help section in the root README.

**product.md**

Describe the application's purpose, target users, primary workflows, capabilities, design principles, and limitations.

**getting-started.md**

Provide a complete installation and first-use procedure, including prerequisites, dependencies, configuration, verification, and expected results.

**user-guide.md**

Document every significant user-facing feature and workflow.

**configuration.md**

Document available configuration options, defaults, valid values, persistence, scope, and effects.

**reference.md**

Document exact technical behaviour, syntax, supported formats, API contracts, commands, validation rules, limits, and compatibility.

**troubleshooting.md**

Provide symptom-based diagnosis and recovery procedures for known and reasonably foreseeable problems.

**architecture.md**

Explain major components, their responsibilities, interactions, data flow, persistence, lifecycle, and technical boundaries.

**development.md**

Explain how to build, test, debug, extend, package, and contribute to the project.

**FAQ.md**

Provide direct answers to realistic user questions covering both basic and advanced functionality.

**roadmap.md**

Clearly separate implemented functionality, known limitations, and genuinely planned functionality. Do not invent a roadmap where no plans are established.

**AI-SUPPORT.md (repository root)**

Combine all support-relevant documentation into one self-contained knowledge base, with a concise dedicated section of instructions for AI assistants near the beginning. Generate this root-level file from the support-relevant source documents; never maintain a second copy under `docs/`.

### Documentation audiences and consolidation scope

Distinguish **end-user/support documentation** (installation, configuration, operation, troubleshooting, recovery, observable behaviour) from **developer/maintainer documentation** (internal architecture, build systems, engineering decisions, contribution workflows).

`AI-SUPPORT.md` is primarily an **end-user technical-support knowledge base**. Include developer or architectural details when they materially help explain observable behaviour, diagnostics, compatibility, storage, or recovery. Keep unrelated internal engineering material in separate documents rather than blindly concatenating every file under `docs/`.

The consolidated document must be comprehensive from a support perspective, without unnecessarily reproducing all internal engineering documentation. Do not omit information that an AI assistant reasonably needs to resolve user problems.

### Mandatory root README: make AI-assisted help discoverable

Update the **repository-root `README.md`** with a visible section near the top (after the project introduction or key links, before lengthy installation or feature details) titled appropriately for the project, such as **"Need help? Ask an AI assistant"**.

The section must:

1. Link directly to the repository-root [`AI-SUPPORT.md`](AI-SUPPORT.md) using a working Markdown link that readers can open and download; do not link only to a documentation index or `llms.txt`.
2. Provide a simple, numbered three-step procedure: **download `AI-SUPPORT.md` → upload or attach it to an AI assistant of the user's choice → ask the question or describe the problem**.
3. Briefly explain that this is the complete project-specific guide, FAQ, and troubleshooting knowledge base, and that the assistant should use it to avoid inventing unsupported features or fixes.
4. When appropriate, link to shorter human-readable guides and the FAQ as alternatives to uploading the full document.
5. Explain how to report genuinely unresolved issues via the project's actual issue tracker or documented feedback channel, if one exists. Request only the minimum relevant versions and redacted diagnostic information. **Do not promise a support desk, response time, or developer support obligation unless the project explicitly provides one.**
6. Match the existing README's tone, formatting, and audience; avoid redundant headings, repeated links, marketing exaggeration, or removing valuable existing content.

**Do not consider the task complete unless the root README contains this discoverable AI-help section and the direct `AI-SUPPORT.md` link works.** Creating `docs/README.md`, `llms.txt`, or the consolidated file alone does not satisfy this requirement.

## 3. Make AI-SUPPORT.md genuinely self-contained

The completed `AI-SUPPORT.md` must be useful when downloaded and uploaded to an AI assistant without the rest of the repository.

Requirements:

1. Include the actual contents of the relevant documentation files, not merely links or summaries.
2. Preserve headings, examples, technical tables, commands, and explanations.
3. Include an index identifying the major topics and where to find them.
4. Include a question-and-symptom index for common support situations.
5. Clearly identify each original documentation section.
6. Explain how relative links should be interpreted when the file is used outside the repository.
7. Use absolute URLs for essential external resources.
8. Avoid requiring access to other local project files to answer ordinary user questions.
9. Include the repository URL and instructions for obtaining additional technical evidence when necessary.
10. Include the project version or revision information where it can be established reliably.

The bundle must remain complete even if an AI assistant has no filesystem access, repository connector, or internet connection.

The source code is authoritative, but **the AI should not normally need to inspect source code to answer routine support questions**.

Where practical, generate `AI-SUPPORT.md` automatically from the individual documentation files to avoid manual duplication and inconsistencies.

Preserve document ordering and use clear source markers.

## 4. Document user-facing functionality comprehensively

For every significant feature, document:

- What the feature does.
- Why and when someone would use it.
- Where it is located.
- How to access it.
- Its prerequisites.
- Its available controls and settings.
- How to use it step by step.
- Its expected results.
- What data it reads or modifies.
- Whether changes are immediate or require saving.
- Whether operations can be undone.
- Important limitations and edge cases.
- Relevant error conditions.
- Troubleshooting procedures.

Use exact UI labels, command names, paths, and terminology found in the application.

Do not invent menus or buttons that do not exist.

For applications without a graphical interface, apply the same principles to commands, APIs, configuration, and programmatic workflows.

Pay particular attention to functionality that may be obvious to the developer but confusing to someone encountering the application for the first time.

## 5. Document technical behaviour precisely

The documentation should answer not only "What does this feature do?" but also "Exactly how does it work?".

Where relevant, document:

- Algorithms and selection behaviour.
- Ordering of operations.
- Validation semantics.
- Parsing and resolution rules.
- Defaults and fallback behaviour.
- Randomness, determinism, and seed handling.
- Case sensitivity.
- Path resolution.
- File naming and extension rules.
- Supported and unsupported formats.
- Numeric limits and boundary conditions.
- Error handling and retry logic.
- Caching and invalidation.
- Background processing.
- State transitions.
- Persistence and migration.
- Behaviour across application restarts.
- Cross-platform differences.
- External-service interactions.

Use examples wherever a rule could reasonably be misunderstood.

Include positive and negative examples for syntax, configuration, input validation, and important edge cases.

For complex operations, explain the relevant sequence of transformations or processing stages.

Avoid documenting irrelevant implementation details that would not help users, maintainers, or AI support.

### Version-aware support

Identify the application version, supported release range, or source revision covered by the documentation. Record only version differences supported by release notes, source history, tests, or other reliable evidence.

Distinguish current features, newly introduced behaviour, deprecated or removed features, version-specific limitations, and relevant migrations. Do not assume that instructions for the newest release apply unchanged to an older installation.

In the AI instructions, require the assistant to establish the user's version when an answer materially depends on it, rather than inventing compatibility details.

## 6. Make troubleshooting a major priority

Assume that many users will approach an AI assistant with a symptom rather than a well-formed technical question.

The troubleshooting documentation must allow the assistant to identify the affected subsystem and suggest a safe, targeted solution.

For each important problem, provide:

**Symptom → Possible causes → Diagnostic checks → Resolution → Expected result**

Include, where relevant:

- Installation failures.
- Missing dependencies.
- Incorrect configuration.
- Authentication or permission failures.
- Network failures and timeouts.
- Third-party service failures.
- Missing files or resources.
- Invalid input.
- Unexpected output.
- Failed operations.
- Performance degradation.
- Application crashes or freezes.
- Data corruption or inconsistent state.
- Version and compatibility problems.
- Platform-specific failures.
- Persistence problems.
- Upgrade and migration failures.
- Known error messages.

Use exact error messages where they exist in the code.

Distinguish between application failures and failures originating from external dependencies.

**Do not recommend destructive operations as generic troubleshooting steps.**

Any procedure involving deletion, resetting settings, clearing caches, overwriting data, rebuilding state, or reinstalling components must explain:

1. What will be affected.
2. What data could be lost.
3. What should be backed up.
4. How to perform the operation safely.
5. What result to expect.

Prefer the least invasive diagnostic procedure first.

If recovery cannot be established from the implementation or existing evidence, say so rather than inventing a solution.

### Support escalation and privacy

Document where users should report unresolved issues, which application/platform versions and relevant error messages to include, and how to describe expected versus actual behaviour.

Explain how to redact passwords, API keys, access tokens, private prompts, personal paths, datasets, and sensitive details from logs or configuration files before sharing them publicly.

AI assistants should request the smallest useful diagnostic excerpt, not entire user directories or unrestricted log archives. Distinguish unsupported behaviour, integration failures, configuration problems, and suspected project defects. If evidence is insufficient, identify the missing diagnostic information instead of inventing a fix.

## 7. Generate a comprehensive, codebase-derived FAQ

Create a dedicated `docs/FAQ.md` containing an extensive, carefully organised collection of questions and answers covering the project's complete user-facing functionality.

**The FAQ is a critical part of the AI-assisted support system. Its purpose is to anticipate the questions users would otherwise ask the developer and provide accurate, actionable answers.**

Do not simply summarise existing documentation or generate generic questions.

### 7.1 Derive questions from the actual application

Systematically inspect the repository to identify questions relating to:

- Every major feature, screen, tab, menu, dialog, and user-facing control.
- Installation, prerequisites, initial setup, and configuration.
- Settings, defaults, persistence, and application state.
- Typical and advanced workflows.
- Supported file formats, syntax, and validation rules.
- Input processing and output generation.
- External tools, integrations, and dependencies.
- Errors, warnings, and troubleshooting.
- Unexpected behaviour and edge cases.
- Performance, resource usage, and limitations.
- Data storage, backups, migrations, and recovery.
- Version compatibility, upgrades, and supported platforms.
- Features that are unavailable, intentionally unsupported, or planned for the future.

Think like a new user, an experienced user, a power user, and a developer attempting to troubleshoot the application.

### 7.2 Anticipate realistic user questions

Generate questions in natural language, including:

- "How do I...?"
- "Where can I find...?"
- "What does this option do?"
- "What happens if...?"
- "Why isn't this working?"
- "Why is this file missing?"
- "Why did the application behave differently than expected?"
- "Can I undo this?"
- "Where is this information stored?"
- "What is the difference between these two settings?"
- "Does this feature support...?"
- "How do I know whether this operation succeeded?"
- "Is this functionality handled by the application or by an external tool?"

Use actual project terminology and features rather than generic placeholders in the completed FAQ.

### 7.3 Provide complete and actionable answers

Each answer should be independently useful.

Where relevant, include:

1. The exact UI location, command, or setting.
2. The prerequisites.
3. The steps required.
4. The expected result.
5. Important limitations or exceptions.
6. What to check when the expected result does not occur.
7. References to more detailed sections when appropriate.

A user or AI assistant should not need to reconstruct an answer from several disconnected passages when a concise, complete answer can be provided directly.

### 7.4 Cover important edge cases

Pay particular attention to situations where the application behaves differently depending on:

- Configuration.
- Operating system.
- Input type.
- Selected mode.
- Existing application state.
- Missing dependencies.
- External-tool availability.
- Permissions.
- Version compatibility.
- Previously saved settings.
- Partial or failed operations.

Document meaningful distinctions explicitly.

### 7.5 Respect external-tool responsibility boundaries

Include questions about configuring and using integrations **within this project**.

Do not recreate the FAQ or user manual of external software.

For example, explain how this application configures, invokes, monitors, or interacts with an external tool, but refer users to that tool's official documentation for its independent functionality, algorithms, advanced options, and internal troubleshooting.

### 7.6 Organise the FAQ for AI retrieval

Group questions under clear, meaningful headings.

Use numbered questions where helpful.

Prefer explicit question titles that closely resemble how users naturally ask for help.

Ensure answers are searchable by feature names, UI labels, error messages, and common terminology.

Cross-reference relevant troubleshooting and reference sections.

Avoid contradictory or outdated answers.

### 7.7 Prioritise coverage over arbitrary length

Do not impose an artificial FAQ question count.

The FAQ should be as extensive as the project's complexity requires.

A substantial application may warrant 100, 200, or more questions. A small utility may need considerably fewer.

**Do not stop merely because the FAQ already appears long. Continue until all significant user-facing subsystems, configuration options, workflows, and common failure scenarios have appropriate coverage.**

Do not manufacture meaningless questions simply to increase the count.

### 7.8 Include the complete FAQ in AI-SUPPORT.md

The complete `docs/FAQ.md` must be incorporated into `AI-SUPPORT.md`, not summarised, shortened, or replaced by a link.

Preserve all questions, answers, headings, examples, and meaningful cross-references.

When the FAQ changes, the consolidated document must be regenerated.

### 7.9 Validate FAQ coverage

After generating the FAQ, perform a coverage audit against the application.

For every major feature or subsystem, verify that users can find answers to:

- What is it?
- How do I use it?
- How do I configure it?
- What are its limitations?
- What can go wrong?
- How do I troubleshoot it?

Identify and fill meaningful gaps before completing the task.

**The FAQ should function as a comprehensive first-line support resource, not simply a list of popular questions.**

## 8. External tools, dependencies, integrations, and responsibility boundaries

Many software projects depend on external tools, frameworks, engines, applications, services, or command-line utilities.

**This project's documentation must clearly explain how it integrates with those external systems, but must never attempt to reproduce, replace, or become the authoritative documentation for those systems.**

The purpose of `AI-SUPPORT.md` is to document **this project**, not every technology it relies upon.

### 8.1 Identify all significant external tools

Inspect the source code, configuration, scripts, and existing documentation to identify external tools and services that users interact with directly or indirectly.

For each significant external dependency, document:

- Its name and primary purpose.
- Its role within this project.
- Whether it is required or optional.
- Whether it must be installed separately.
- Whether this project launches, controls, configures, or merely communicates with it.
- Which functionality this project implements itself versus delegates to the external tool.
- Where users can obtain the external tool.
- Links to its official repository, website, and documentation.
- Known compatibility requirements, where verified.

Do not document every internal software dependency individually. Focus on integrations and external systems whose behaviour matters to users.

### 8.2 Establish explicit responsibility boundaries

For each important integration, distinguish three categories:

**A. Responsibilities of this project**

Document these comprehensively:

- Integration setup within this application.
- User-facing configuration and controls.
- Input preparation and validation performed by this application.
- Commands, parameters, or files passed to the external tool.
- How the application launches or communicates with the external tool.
- How it tracks progress and receives results.
- How it displays errors and reports failures.
- Output processing, file management, and metadata handling.
- Project-specific compatibility requirements.
- Integration-specific limitations and troubleshooting.

**B. Responsibilities of the external tool**

Identify these clearly, without reproducing the external tool's full documentation.

Examples include:

- The external tool's internal algorithms and execution logic.
- Its own installation and environment management.
- Hardware and runtime requirements.
- Its supported models, formats, and features.
- Its advanced configuration options.
- Its internal errors and troubleshooting.
- Its own updates, compatibility, and known issues.

The precise responsibilities depend on the integration and must be established from the project's actual implementation.

**C. Shared or overlapping responsibilities**

Some problems arise at the boundary between this project and an external tool.

Document how users can distinguish between them.

For example:

- An input rejected before execution may indicate this project's validation.
- A process failing after launch may originate from the external tool.
- A generated configuration file may be produced by this project but interpreted by the external tool.
- Missing output may result from either a failed external operation or incorrect output tracking.

Provide practical diagnostic procedures that help identify which component is responsible.

Do not automatically blame either system when the source of failure is uncertain.

### 8.3 Link to official external documentation

For every significant external tool, provide direct links to its authoritative documentation, preferably including:

- Official repository or website.
- Installation and setup instructions.
- User guide or usage documentation.
- Configuration or technical reference.
- Troubleshooting documentation, when available.

Only include links that have been verified.

If the external tool has limited or incomplete documentation, acknowledge that rather than inventing authoritative resources.

Where practical, explain which external documentation users should consult for particular questions.

**Do not copy substantial sections of external documentation into this project's knowledge base.**

This avoids duplication, maintenance problems, copyright concerns, and outdated instructions.

### 8.4 Document only the integration-specific setup

Some installation or configuration steps for an external tool may be essential to using this project.

Document those steps only to the extent necessary to establish a working integration.

For example, if this application requires an external service to run on a particular port, or requires a particular custom node, executable, API endpoint, or configuration setting, document that requirement precisely.

However, do not reproduce the external tool's entire installation tutorial, configuration reference, or advanced usage guide.

Instead, direct users to its official documentation for the general setup procedure.

The intended distinction is:

**"How to configure this tool to work with our application"** belongs here.

**"How to install, operate, configure, and troubleshoot every feature of that external tool"** belongs in the external tool's documentation.

### 8.5 Troubleshooting external integrations

Document failures that involve this application's integration with external systems.

For each failure, distinguish:

1. Problems originating inside this application.
2. Problems caused by incorrect integration configuration.
3. Problems reported by the external tool.
4. Problems whose origin cannot be established without additional evidence.

Explain what this application can verify and what must be verified using the external tool.

For failures entirely within the external tool, provide the relevant official documentation or issue-tracker link rather than inventing troubleshooting instructions.

An AI assistant using `AI-SUPPORT.md` should not confidently diagnose the internals of an external tool without appropriate supporting information.

If the assistant has access to authoritative, current external documentation, it may consult it separately, clearly distinguishing that information from this project's own documentation.

### 8.6 Include an integration responsibility table

For each major external integration, include a concise table similar to the following:

| Area | This project | External tool |
|---|---|---|
| Installation | Documents integration prerequisites | Documents its own installation |
| Configuration | Documents project-specific settings | Documents general and advanced settings |
| Execution | Describes how the project invokes or controls execution | Implements the underlying execution |
| Progress | Explains how the project obtains and displays status | Produces execution status |
| Errors | Explains integration-level handling | Documents internal failures |
| Outputs | Documents how the project locates and processes results | Documents output generation |

Adapt this table to actual behaviour. Do not claim capabilities or responsibilities that the source code does not establish.

### 8.7 Add explicit rules for AI assistants

The `Information for LLM models` section must contain the following principles:

- This documentation is authoritative about **this project**, not its external dependencies.
- Do not attribute external-tool capabilities to this project.
- Do not assume this project implements an external tool's functionality simply because it provides a UI for that functionality.
- Distinguish configuration generated by this project from configuration interpreted by the external tool.
- Do not invent unsupported external-tool commands, settings, parameters, or installation procedures.
- For general external-tool questions, refer to the corresponding official documentation.
- For integration questions, explain the precise responsibility boundary.
- If a failure originates in an external tool, acknowledge that and direct the user to the appropriate external documentation.
- If the origin of a failure is uncertain, provide evidence-based diagnostic steps rather than assigning blame.
- Do not reproduce external documentation merely to make `AI-SUPPORT.md` appear more comprehensive.

### 8.8 Fundamental principle

**Comprehensive project documentation does not mean comprehensive documentation of every dependency.**

The objective is to make users and AI assistants fully understand:

1. What this project does.
2. What it delegates to external systems.
3. How those systems interact.
4. How to configure and troubleshoot the integration.
5. Where to find authoritative information about functionality belonging to the external systems.

The documentation should be exhaustive about this project's responsibilities and deliberately bounded regarding everything else.

## 9. Add a dedicated "Information for LLM models" section

Place a clearly labelled **Instructions for AI Assistants** section near the beginning of `AI-SUPPORT.md`, after the document identity and question/symptom index, before the main guide.

This section is essential.

It should contain compact, authoritative statements about behaviour that an AI might otherwise misunderstand or hallucinate.

Include the following rules, adapted to the project:

### Answering rules

- Answer questions using the supplied documentation as the primary reference.
- Prefer exact documented behaviour over general assumptions about similar software.
- Use exact UI labels, commands, paths, configuration keys, and error names.
- Explain where users should navigate and what actions they should take.
- Do not invent functionality, controls, settings, commands, or APIs.
- Distinguish implemented features from planned features.
- Distinguish project behaviour from third-party behaviour.
- Do not claim a feature exists merely because it is common in similar applications.
- If documentation and source code disagree, the source code and relevant tests are authoritative.
- If the answer is not established by the document, acknowledge the limitation.
- If repository access is available, inspect the relevant implementation before making unsupported claims.
- Never present an assumption as verified behaviour.

### Troubleshooting rules

When a user reports an issue:

1. Identify the affected component and symptom.
2. Consult the relevant troubleshooting documentation.
3. Verify prerequisites before proposing configuration changes.
4. Distinguish application failures from external failures.
5. Prefer non-destructive diagnostics.
6. Explain the expected results of each proposed check.
7. Avoid speculative fixes.
8. Respect documented recovery and data-safety procedures.
9. Ask for additional information only when necessary.
10. If the issue appears to be an undocumented bug, recommend an appropriate bug report with relevant diagnostic information.

### Project-specific facts

Create a concise factual reference covering important mechanical details, such as:

- Application tabs, menus, and major features.
- Configuration locations and defaults.
- Storage and persistence rules.
- Supported file formats.
- Important algorithms or transformation ordering.
- Dependency requirements.
- Significant limitations.
- Known compatibility differences.
- Error codes and their meanings.
- Undo, backup, and recovery behaviour.
- Update and migration behaviour.
- External integration boundaries.

This section should serve as an authoritative summary of potentially confusing implementation details.

Do not include generic AI instructions at the expense of actual project-specific knowledge.

## 10. Prevent contradictions and documentation drift

Cross-check the documentation for inconsistencies.

Pay particular attention to:

- Different names for the same feature.
- UI labels versus internal identifiers.
- Conflicting defaults.
- Contradictory statements about persistence.
- Incorrect file paths.
- Different descriptions of the same error.
- Features described as both implemented and planned.
- Inconsistent installation requirements.
- Incorrect compatibility claims.
- Differences between documentation and source code.

When internal terminology differs from visible user terminology, explain the relationship explicitly.

Do not conceal contradictions by arbitrarily choosing one description. Verify the implementation.

Where code comments, tests, documentation, and implementation disagree, identify the discrepancy and document the verified behaviour.

## 11. Make the documentation suitable for long-term maintenance

Create or update a Cursor project rule, following the existing rules convention and without overwriting unrelated rules, to enforce documentation maintenance during future development.

The rule should require that whenever project behaviour changes, the relevant documentation is updated in the same change.

Examples:

- New UI control → update user guide.
- New setting → update configuration reference.
- New error or diagnostic → update troubleshooting.
- New command/API → update technical reference.
- Changed behaviour → update all affected descriptions and FAQ entries.
- New dependency → update installation and integration documentation.
- Removed feature → remove obsolete instructions.
- Changed persistence → update storage and migration information.
- Changed architecture → update architecture documentation.
- Bug fix affecting documented behaviour → review corresponding support instructions.

After source documentation changes, rebuild `AI-SUPPORT.md`.

**Do not allow the consolidated document to diverge from its source documents.**

Where practical, create a deterministic documentation bundling script and a validation/check command.

The validation should detect:

- A missing root-README AI-help section or broken link to `AI-SUPPORT.md`.

- Missing expected source documents.
- Outdated consolidated documentation.
- Broken local links.
- Duplicate or missing sections.
- Unexpected differences between source documents and their bundled copies.

If straightforward and reliable, add checks for undocumented user-visible errors, diagnostic identifiers, or configuration keys.

Do not create fragile automated checks that produce excessive false positives.

Document the regeneration and validation commands.

### Enforce documentation freshness in CI

If the repository already has continuous integration (CI), add the deterministic documentation validation command to an appropriate existing CI workflow so that pull requests and relevant pushes fail when `AI-SUPPORT.md` is stale or inconsistent with its source documents.

Where no CI exists, provide a simple documented check command that can later be integrated into CI; do not introduce a new CI platform or major infrastructure solely for this purpose unless clearly appropriate to the repository.

The check must **verify without silently regenerating or modifying files**: regenerate into a temporary location or compare deterministic output against the committed bundle, then fail with a clear instruction for how to rebuild it. Keep actual regeneration as an explicit separate command.

Respect existing CI conventions and permissions, and avoid broad workflow changes unrelated to documentation. Report whether CI enforcement was actually added, or why it was not applicable.

### Optional AI documentation discovery (`llms.txt`)

Where appropriate, create or update a **small** `llms.txt` file at the repository root containing the project name, a short description, and a stable link to the canonical `AI-SUPPORT.md`. Optional links may point to the repository, releases, and issue tracker.

Do **not** duplicate the consolidated documentation in `llms.txt`, and do not create `llms-full.txt` unless explicitly requested. `AI-SUPPORT.md` remains the single authoritative support file. Treat `llms.txt` as an optional discovery convention, **not** a guarantee that AI assistants automatically load it.

## 12. Quality requirements

The final documentation must be:

**Comprehensive:** Cover the application's actual functionality, not just its highlights.

**Accurate:** Every technical claim must be supported by source code, tests, or reliable existing documentation.

**Self-contained:** An AI should be able to answer ordinary questions from `AI-SUPPORT.md` alone.

**Actionable:** Instructions should tell users exactly what to do and what should happen.

**Unambiguous:** Avoid vague directions and inconsistent terminology.

**Safe:** Recovery procedures must explain consequences and avoid unnecessary data loss.

**Maintainable:** Changes to the application should trigger updates to the relevant documentation.

**AI-friendly:** Organise content for effective retrieval and prevent speculative answers.

**Efficient:** Provide sufficient detail without repeating irrelevant information.

Do not impose an artificial page count, line count, or FAQ count.

The appropriate length is whatever is necessary to cover the application properly.

A large complex project may require extensive documentation. A small utility may require much less.

## 13. Validate the finished documentation

Before considering the task complete:

1. Check that all major application subsystems are represented.
2. Verify UI labels and commands against the source code.
3. Verify documented defaults and configuration keys.
4. Verify installation commands and dependency information.
5. Verify error messages and diagnostic codes.
6. Check internal cross-references.
7. Confirm that the consolidated document contains the complete intended content.
8. Check that the LLM-specific section is consistent with the rest of the documentation.
9. Verify that planned functionality is not described as implemented.
10. Confirm that regeneration produces consistent output.
11. Run any documentation validation checks created for this task.
12. Fix identified errors before finishing.

Perform an additional review by imagining that an AI assistant has access **only** to `AI-SUPPORT.md`.

Test whether it could answer realistic questions about installation, features, configuration, troubleshooting, unexpected behaviour, storage, compatibility, and recovery.

Identify and address meaningful knowledge gaps discovered during this review.

Do not fabricate missing implementation details simply to make the document appear complete.

### AI support evaluation and regression tests

Create `docs/support-evaluation.md` with representative, realistic support questions drawn **independently from the codebase, tests, UI flows, error messages, configuration, and credible user scenarios**. Do not simply rewrite questions from the generated FAQ or derive the evaluation set from `AI-SUPPORT.md`; that would create a circular test that only rewards the documentation for repeating itself. After defining the questions and expected outcomes independently, locate the relevant documentation sections and identify coverage gaps.

Include questions about installation, configuration, ordinary and advanced workflows, unexpected behaviour, known errors, recovery, and external integrations.

**Include an explicit minimum set of deliberately unanswerable or misleading cases**: nonexistent UI controls/settings, unsupported or removed features, ambiguous symptoms that require clarification, version-dependent facts that cannot be established, and uncertain third-party internals. For such cases, the expected successful behaviour is to state the limitation, request only necessary clarification, or refer to authoritative upstream information—not to invent an answer. These cases are mandatory even for otherwise simple projects; adapt the examples to what genuinely applies.

For each case record:

1. A natural-language user question or symptom.
2. The expected answer or diagnostic process.
3. The authoritative section(s) of `AI-SUPPORT.md`.
4. Common hallucinations or unsafe advice to avoid.
5. Criteria for a correct, complete, and appropriately cautious response.
6. The expected handling of uncertainty, including when abstention, clarification, or upstream referral is the correct outcome.

Where an AI evaluation interface is actually available, test the cases using **only** `AI-SUPPORT.md` as project context. Measure factual correctness, practical usefulness, terminology, uncertainty handling, and unsupported claims. Count correct refusal to invent an undocumented answer as a **successful** outcome, not a failure to answer. Report which tests were executed and which were not. Do not invent a success rate or claim model testing occurred when it did not.

Keep the evaluation cases alongside the documentation so changes can be checked for regressions. The evaluation document is a maintainer aid and does not need to be bundled into the user-facing `AI-SUPPORT.md`.

## 14. Completion requirements

Carry out the work. Do not stop after creating an outline or planning the documentation.

Create or update the actual documentation files.

Preserve existing valuable content and avoid unrelated source-code changes.

At completion, provide a concise report containing:

1. Documentation files created or updated.
2. Total size and approximate line count of `AI-SUPPORT.md`.
3. Major functional areas covered.
4. Number of FAQ entries and troubleshooting topics.
5. Documentation build and validation commands.
6. Whether a persistent documentation-maintenance rule was created or updated.
7. Any unresolved documentation gaps or behaviour that could not be verified.
8. The support-evaluation cases created, and which (if any) were actually run against an AI.
9. Whether an optional `llms.txt` discovery pointer was created.
10. Whether CI now enforces documentation freshness, or why CI integration was not added.
11. How many evaluation cases test unsupported, ambiguous, or deliberately unanswerable questions.
12. Confirmation that the **root `README.md`** prominently explains the AI-help workflow and links directly to `AI-SUPPORT.md`.

Do not claim completeness if important subsystems were not examined.

Do not claim tests passed unless they actually ran successfully.

---

## Final instruction

**The objective is not simply to produce documentation. It is to make this software as close to self-supporting as reasonably possible through AI-assisted help.**

Assume that the developer wants to spend their time developing the software, not repeatedly answering questions whose answers could have been provided by a well-informed AI assistant.

A successful result is a knowledge base that allows users to solve the vast majority of ordinary problems independently, without requiring the developer's intervention.

Investigate the repository thoroughly, document verified behaviour, create the consolidated `AI-SUPPORT.md`, establish the documentation-maintenance workflow, validate the result, and complete the task.