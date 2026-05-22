#include <mach-o/dyld.h>
#include <limits.h>
#include <libgen.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

int main(void) {
  char executablePath[PATH_MAX];
  uint32_t size = sizeof(executablePath);

  if (_NSGetExecutablePath(executablePath, &size) != 0) {
    return 1;
  }

  char resolvedPath[PATH_MAX];
  if (realpath(executablePath, resolvedPath) == NULL) {
    return 1;
  }

  char macosDir[PATH_MAX];
  snprintf(macosDir, sizeof(macosDir), "%s", resolvedPath);
  dirname(macosDir);

  char projectDir[PATH_MAX];
  snprintf(projectDir, sizeof(projectDir), "%s/../../..", macosDir);

  char resolvedProjectDir[PATH_MAX];
  if (realpath(projectDir, resolvedProjectDir) == NULL) {
    return 1;
  }

  char launcherScript[PATH_MAX];
  snprintf(launcherScript, sizeof(launcherScript), "%s/macos/start-launcher.sh", resolvedProjectDir);

  pid_t pid = fork();
  if (pid < 0) {
    return 1;
  }

  if (pid == 0) {
    setsid();
    execl("/bin/zsh", "zsh", launcherScript, (char *)NULL);
    _exit(127);
  }

  return 0;
}
