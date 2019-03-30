import * as Octokit from "@octokit/rest";
import {
  deleteRef,
  fetchRefSha,
  PullRequestNumber,
  Ref,
  RepoName,
  RepoOwner,
} from "shared-github-internals/lib/git";
import { createTestContext } from "shared-github-internals/lib/tests/context";
import {
  createPullRequest,
  createRefs,
  DeleteRefs,
  fetchRefCommits,
  RefsDetails,
} from "shared-github-internals/lib/tests/git";

import { backportPullRequest } from ".";

let octokit: Octokit;
let owner: RepoOwner;
let repo: RepoName;

beforeAll(() => {
  ({ octokit, owner, repo } = createTestContext());
});

describe("nominal behavior", () => {
  const [initial, dev, feature1st, feature2nd] = [
    "initial",
    "dev",
    "feature 1st",
    "feature 2nd",
  ];

  const [initialCommit, devCommit, feature1stCommit, feature2ndCommit] = [
    {
      lines: [initial, initial, initial],
      message: initial,
    },
    {
      lines: [dev, initial, initial],
      message: dev,
    },
    {
      lines: [dev, feature1st, initial],
      message: feature1st,
    },
    {
      lines: [dev, feature1st, feature2nd],
      message: feature2nd,
    },
  ];

  const state = {
    initialCommit,
    refsCommits: {
      dev: [devCommit],
      feature: [devCommit, feature1stCommit, feature2ndCommit],
      master: [],
    },
  };

  let actualBase: Ref;
  let actualBody: string;
  let actualHead: Ref;
  let actualTitle: string;
  let backportedPullRequestNumber: PullRequestNumber;
  let deleteRefs: DeleteRefs;
  let featurePullRequestNumber: PullRequestNumber;
  let givenBase: Ref;
  let givenBody: string;
  let givenTitle: string;
  let refsDetails: RefsDetails;

  beforeAll(async () => {
    ({ deleteRefs, refsDetails } = await createRefs({
      octokit,
      owner,
      repo,
      state,
    }));
    givenBase = refsDetails.master.ref;
    featurePullRequestNumber = await createPullRequest({
      base: refsDetails.dev.ref,
      head: refsDetails.feature.ref,
      octokit,
      owner,
      repo,
    });
    givenBody = `Backport #${featurePullRequestNumber}.`;
    givenTitle = `Backport #${featurePullRequestNumber} to ${givenBase}`;
    backportedPullRequestNumber = await backportPullRequest({
      base: givenBase,
      body: givenBody,
      octokit,
      owner,
      pullRequestNumber: featurePullRequestNumber,
      repo,
      title: givenTitle,
    });
    ({
      data: {
        base: { ref: actualBase },
        body: actualBody,
        head: { ref: actualHead },
        title: actualTitle,
      },
    } = await octokit.pulls.get({
      number: backportedPullRequestNumber,
      owner,
      repo,
    }));
  }, 30000);

  afterAll(async () => {
    await deleteRefs();
    await deleteRef({
      octokit,
      owner,
      ref: actualHead,
      repo,
    });
  });

  test("pull request made on the expected base", () => {
    expect(actualBase).toBe(givenBase);
  });

  test("given body is respected", () => {
    expect(actualBody).toBe(givenBody);
  });

  test("head default is respected", () => {
    expect(actualHead).toBe(
      `backport-${featurePullRequestNumber}-to-${givenBase}`,
    );
  });

  test("given title is respected", () => {
    expect(actualTitle).toBe(givenTitle);
  });

  test("commits on the backported pull request are the expected ones", async () => {
    const actualCommits = await fetchRefCommits({
      octokit,
      owner,
      ref: actualHead,
      repo,
    });
    expect(actualCommits).toEqual([
      initialCommit,
      {
        lines: [initial, feature1st, initial],
        message: feature1st,
      },
      {
        lines: [initial, feature1st, feature2nd],
        message: feature2nd,
      },
    ]);
  });
});

describe("atomicity", () => {
  const [initial, dev, feature] = ["initial", "dev", "feature"];

  const [initialCommit, devCommit, featureCommit] = [
    {
      lines: [initial],
      message: initial,
    },
    {
      lines: [dev],
      message: dev,
    },
    {
      lines: [feature],
      message: feature,
    },
  ];

  const state = {
    initialCommit,
    refsCommits: {
      dev: [devCommit],
      feature: [featureCommit],
      master: [],
    },
  };

  let deleteRefs: DeleteRefs;
  let featurePullRequestNumber: PullRequestNumber;
  let refsDetails: RefsDetails;

  beforeAll(async () => {
    ({ deleteRefs, refsDetails } = await createRefs({
      octokit,
      owner,
      repo,
      state,
    }));
    featurePullRequestNumber = await createPullRequest({
      base: refsDetails.master.ref,
      head: refsDetails.feature.ref,
      octokit,
      owner,
      repo,
    });
  }, 20000);

  afterAll(async () => {
    await deleteRefs();
  });

  test("whole operation aborted when the commits cannot be cherry-picked", async () => {
    const head = `backport-${featurePullRequestNumber}-to-${
      refsDetails.dev.ref
    }`;

    const ensureHeadRefExists = () =>
      fetchRefSha({ octokit, owner, ref: head, repo });

    let intercepted = false;

    await expect(
      backportPullRequest({
        async _intercept() {
          await ensureHeadRefExists();
          intercepted = true;
        },
        base: refsDetails.dev.ref,
        head,
        octokit,
        owner,
        pullRequestNumber: featurePullRequestNumber,
        repo,
      }),
    ).rejects.toThrow(/could not be cherry-picked/u);

    expect(intercepted).toBeTruthy();

    await expect(ensureHeadRefExists()).rejects.toThrow(/Not Found/u);
  }, 20000);
});
