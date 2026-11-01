// Runs before every test file.
//
// When the suite runs from a git hook (`pre-push` in particular) git exports GIT_DIR,
// GIT_INDEX_FILE and friends, pointing at the repository being pushed. Anything that
// shells out to git — directly, or through `simple-git` in src/cli.ts — would then read
// and write that repository instead of the temp fixture it was aimed at. Strip them, so a
// hook-run suite behaves exactly like a terminal-run one.
//
// This prevents fixture git commands from accidentally targeting the checkout
// that invoked the test suite.
for (const key of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
]) {
  delete process.env[key];
}
