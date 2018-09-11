// @flow strict

import type { Github } from "@octokit/rest";
import createDebug from "debug";
import cherryPick from "github-cherry-pick";
import {
  type PullRequestNumber,
  type RepoName,
  type RepoOwner,
  type Reference,
  type Sha,
  createReference,
  deleteReference,
  fetchCommits,
  fetchReferenceSha,
} from "shared-github-internals/lib/git";

import { name as packageName } from "../package";

type PullRequestBody = string;

type PullRequestTitle = string;

const backportPullRequest = async ({
  // Should only be used in tests.
  _intercept = () => Promise.resolve(),
  base,
  body: givenBody,
  head: givenHead,
  number,
  octokit,
  owner,
  repo,
  title: givenTitle,
}: {
  _intercept?: ({ commits: Array<Sha> }) => Promise<void>,
  base: Reference,
  body?: PullRequestBody,
  head?: Reference,
  number: PullRequestNumber,
  octokit: Github,
  owner: RepoOwner,
  repo: RepoName,
  title?: PullRequestTitle,
}): Promise<PullRequestNumber> => {
  const {
    body = `Backport #${number}.`,
    head = `backport-${number}-on-${base}`,
    title = `Backport #${number} on ${base}`,
  } = { body: givenBody, head: givenHead, title: givenTitle };

  const debug = createDebug(packageName);
  debug("starting", { base, body, head, number, owner, repo, title });

  const baseSha = await fetchReferenceSha({
    octokit,
    owner,
    ref: base,
    repo,
  });

  debug("fetching commits");
  const commits = await fetchCommits({ number, octokit, owner, repo });

  debug("creating reference");
  await createReference({
    octokit,
    owner,
    ref: head,
    repo,
    sha: baseSha,
  });
  debug("reference created");

  await _intercept({ commits });

  try {
    try {
      debug("cherry-picking commits", commits);
      const headSha = await cherryPick({
        commits,
        head,
        octokit,
        owner,
        repo,
      });
      debug("commits cherry-picked", headSha);
    } catch (error) {
      debug("commits could not be cherry-picked", error);
      throw new Error(
        `Commits ${JSON.stringify(
          commits
        )} could not be cherry-picked on top of ${base}`
      );
    }
    debug("creating pull request");
    const {
      data: { number: backportedPullRequestNumber },
    } = await octokit.pullRequests.create({
      base,
      body,
      head,
      owner,
      repo,
      title,
    });
    debug("pull request created", backportedPullRequestNumber);
    return backportedPullRequestNumber;
  } catch (error) {
    debug("rollbacking reference creation", error);
    await deleteReference({ octokit, owner, ref: head, repo });
    debug("reference creation rollbacked");
    throw error;
  }
};

export default backportPullRequest;
