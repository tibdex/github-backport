import * as Octokit from "@octokit/rest";
import * as createDebug from "debug";
import cherryPick from "github-cherry-pick";
import {
  createReference,
  deleteReference,
  fetchCommits,
  fetchReferenceSha,
  PullRequestNumber,
  Reference,
  RepoName,
  RepoOwner,
  Sha,
} from "shared-github-internals/lib/git";

const debug = createDebug("github-backport");

type PullRequestBody = string;

type PullRequestTitle = string;

const backportPullRequest = async ({
  // Should only be used in tests.
  _intercept = () => Promise.resolve(),
  base,
  body: givenBody,
  head: givenHead,
  octokit,
  owner,
  pullRequestNumber,
  repo,
  title: givenTitle,
}: {
  _intercept?: ({ commits }: { commits: Sha[] }) => Promise<void>;
  base: Reference;
  body?: PullRequestBody;
  head?: Reference;
  octokit: Octokit;
  owner: RepoOwner;
  pullRequestNumber: PullRequestNumber;
  repo: RepoName;
  title?: PullRequestTitle;
}): Promise<PullRequestNumber> => {
  const {
    body = `Backport #${pullRequestNumber}.`,
    head = `backport-${pullRequestNumber}-on-${base}`,
    title = `Backport #${pullRequestNumber} on ${base}`,
  } = { body: givenBody, head: givenHead, title: givenTitle };

  debug("starting", {
    base,
    body,
    head,
    owner,
    pullRequestNumber,
    repo,
    title,
  });

  const baseSha = await fetchReferenceSha({
    octokit,
    owner,
    ref: base,
    repo,
  });

  debug("fetching commits");
  const commits = await fetchCommits({
    octokit,
    owner,
    pullRequestNumber,
    repo,
  });

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
          commits,
        )} could not be cherry-picked on top of ${base}`,
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
