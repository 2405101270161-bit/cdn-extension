---
description: How to collaborate using Engineer and Designer roles to avoid code conflicts.
---

# Conflict-Free Collaboration Workflow

Use this workflow to prevent code conflicts when working comprehensively on features that require both logical and visual changes.

## Step 1: Clarify the Goal
Before writing code, explicitly decide if the current task is primarily structural/logical (Engineer task) or visual (Designer task).
If both are required, split the task into a logic phase and a design phase.

## Step 2: Engineer Phase
- **Role**: Backend/Frontend Logic Engineer
- **Goal**: Implement the core logic first. Write robust JavaScript (`.js`), network fetching, state changes, etc.
- **Rule**: Do not add unnecessary style changes. Output plain HTML with clear semantic class names (e.g., `class="cdn-card"`, `id="analyzer-results"`).

## Step 3: Designer Phase
- **Role**: UI/UX Designer
- **Goal**: Hook into the semantic class/ID names created by the Engineer and style them.
- **Rule**: Write purely to CSS (`styles.css`) or add purely visual wrappers in the HTML without altering logic flows or removing IDs/classes that JavaScript depends on.

## Step 4: Verification
- After both phases, run the extension or application.
- Ensure the UI looks exactly as the Designer intended.
- Ensure the functionality works perfectly as the Engineer intended.

### Branches (Optional but recommended)
Always check out a specific branch for your role to avoid merge conflicts:
- For logic: `git checkout -b feature/engineer-[name]`
- For design: `git checkout -b feature/designer-[name]`
