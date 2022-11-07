import chalk from "chalk";
import { spawn } from "child_process";
import path from "path";

import * as git from "@changesets/git";
import { error, info, log, warn } from "@changesets/logger";
import { Config } from "@changesets/types";
import writeChangeset from "@changesets/write";
import { getPackages } from "@manypkg/get-packages";
import * as cli from "../../utils/cli-utilities";

import { ExternalEditor } from "external-editor";
import { getCommitFunctions } from "../../commit/getCommitFunctions";
import createChangeset from "./createChangeset";
import { isListablePackage } from "./isListablePackage";
import printConfirmationMessage from "./messages";

export default async function create(
  cwd: string,
  {
    empty,
    open,
    filter,
    bump,
    summary,
  }: {
    empty?: boolean;
    open?: boolean;
    filter?: string;
    bump?: string;
    summary?: string;
  },
  config: Config
) {
  const packages = await getPackages(cwd);
  if (packages.packages.length === 0) {
    throw new Error(
      `No packages found. You might have ${packages.tool} workspaces configured but no packages yet?`
    );
  }
  const listablePackages = packages.packages.filter((pkg) =>
    isListablePackage(config, pkg.packageJson)
  );
  const changesetBase = path.resolve(cwd, ".changeset");

  let newChangeset: Awaited<ReturnType<typeof createChangeset>>;
  if (empty) {
    newChangeset = {
      confirmed: true,
      releases: [],
      summary: ``,
    };
  } else {
    const changedPackages = await git.getChangedPackagesSinceRef({
      cwd,
      ref: config.baseBranch,
    });
    if (changedPackages.length > 0) {
      const changedPackagesName = changedPackages
        .filter(
          (pkg) =>
            isListablePackage(config, pkg.packageJson) &&
            (!filter || (filter && pkg.packageJson.name === filter))
        )
        .map((pkg) => pkg.packageJson.name);
      console.log(
        "[Tip] 🔥 listablePackages bump ===> ",
        filter,
        bump,
        summary
      );
      newChangeset = await createChangeset(
        changedPackagesName,
        listablePackages,
        bump,
        summary
      );
      printConfirmationMessage(newChangeset, listablePackages.length > 1);
      if (!bump && !filter) {
        if (!newChangeset.confirmed) {
          newChangeset = {
            ...newChangeset,
            confirmed: await cli.askConfirm("Is this your desired changeset?"),
          };
        }
      } else {
        newChangeset.confirmed = true;
      }
    } else {
      if (filter) {
        newChangeset = await createChangeset(
          [filter],
          listablePackages,
          bump,
          summary
        );
        printConfirmationMessage(newChangeset, listablePackages.length > 1);
        if (!bump && !filter) {
          if (!newChangeset.confirmed) {
            newChangeset = {
              ...newChangeset,
              confirmed: await cli.askConfirm(
                "Is this your desired changeset?"
              ),
            };
          }
        } else {
          newChangeset.confirmed = true;
        }
      } else {
        newChangeset = {
          confirmed: false,
          releases: [],
          summary: ``,
        };
        error("No changed files detected.");
      }
    }
  }

  if (newChangeset.confirmed) {
    const changesetID = await writeChangeset(newChangeset, cwd);
    const [{ getAddMessage }, commitOpts] = getCommitFunctions(
      config.commit,
      cwd
    );
    if (getAddMessage) {
      await git.add(path.resolve(changesetBase, `${changesetID}.md`), cwd);
      await git.commit(await getAddMessage(newChangeset, commitOpts), cwd);
      log(chalk.green(`${empty ? "Empty " : ""}Changeset added and committed`));
    } else {
      log(
        chalk.green(
          `${empty ? "Empty " : ""}Changeset added! - you can now commit it\n`
        )
      );
    }

    let hasMajorChange = [...newChangeset.releases].find(
      (c) => c.type === "major"
    );

    if (hasMajorChange) {
      warn(
        "This Changeset includes a major change and we STRONGLY recommend adding more information to the changeset:"
      );
      warn("WHAT the breaking change is");
      warn("WHY the change was made");
      warn("HOW a consumer should update their code");
    } else {
      log(
        chalk.green(
          "If you want to modify or expand on the changeset summary, you can find it here"
        )
      );
    }
    const changesetPath = path.resolve(changesetBase, `${changesetID}.md`);
    info(chalk.blue(changesetPath));

    if (open) {
      // this is really a hack to reuse the logic embedded in `external-editor` related to determining the editor
      const externalEditor = new ExternalEditor();
      externalEditor.cleanup();
      spawn(
        externalEditor.editor.bin,
        externalEditor.editor.args.concat([changesetPath]),
        {
          detached: true,
          stdio: "inherit",
        }
      );
    }
  }
}
