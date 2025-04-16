import * as core from "@actions/core";
import * as github from "@actions/github";

export async function run(): Promise<void> {
  try {
    
    // Get the inputs from the workflow file
    const token: string = core.getInput("github_token");
    const owner: string = core.getInput("owner");
    const repo: string = core.getInput("repo");
    const printSummary: boolean = core.getInput("print_summary") === "true";

    const doNotBreakPRCheck: boolean =
      core.getInput("do_not_break_pr_check") === "true";

    const maxAlerts: number = parseInt(core.getInput("max_alerts"), 10);
     
    const octokit: ReturnType<typeof github.getOctokit> =
      github.getOctokit(token);

    // Fetch Secret Scanning Alerts
    let alerts_default = await octokit.paginate(
      octokit.rest.secretScanning.listAlertsForRepo,
      {
        owner,
        repo,
        state: "open",
        per_page: 100, // Fetch up to 100 alerts per page
      },
    )

    // Github does not expose Generic Secret Alerts on the API unless filtered.
    // A ticket was opened with Github to report it
    // Currently we have to filter the alerts by the type of secret
    // https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns
    let alerts_generic = await octokit.paginate(
      octokit.rest.secretScanning.listAlertsForRepo,
      {
        owner,
        repo,
        state: "open",
        secret_type: "password,http_basic_authentication_header,http_bearer_authentication_header,mongodb_connection_string,mysql_connection_string,openssh_private_key,pgp_private_key,postgres_connection_string,rsa_private_key",
        per_page: 100, // Fetch up to 100 alerts per page
      },
    )

    // Concatenate Alerts, avoid duplicates, if the number is the same on both alert vars, use only one
    let alerts = alerts_default.concat(alerts_generic).filter((alert, index, self) =>
      index === self.findIndex((a) => a.number === alert.number)
    );

    // Fetch files changed in the PR. If it's a PR workflow we are going to use this to filter alerts
    const prNumber = github.context.payload.pull_request?.number;
    let prFiles: string[] = [];
    if (prNumber) {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
      });
      prFiles = files.map((file) => file.filename);
      core.info(
        "This is a PR Check. The following files are not being validated as it might have fixes: " +
          prFiles.join(", "),
      );
    }

    // Group alerts by severity level dynamically
    // const severityCounts: Record<string, number> = {};
    let alertCount: number = alerts.length;
    const breakingAlerts: string[] = []; // Array to store formatted alert details
    const nonBreakingAlerts: string[] = []; // Array to store formatted alert details
    const breakingAlertsPRFiles: string[] = []; // Array to store alert files that are part of the PR
    const nonBreakingAlertsPRFiles: string[] = []; // Array to store alert files that are part of the PR
    const disregardAlerts: number[] = []; // Array to store alert files that are part of the PR

    
    for (const alert of alerts) {   
      let isFileInPR = false;
      // Get the affected file, only if this is a PR Check, to avoid unecessary github api calls
      if (prNumber) {
        if (alert.locations_url) {
          try {
            const { data: locations } = await octokit.request(`GET ${alert.locations_url}`);
            // Github returns an array, but always the first element is the one we want
            if (locations.length > 0 && locations[0].details?.path) {
              isFileInPR = prFiles.includes(locations[0].details.path);
            }
          }
          catch (error) {
            // Handle the case where the request fails or the location is not found
            core.warning(`Failed to fetch alert location for alert Number: ${alert.number}`);
          }
        }
      }    

      // Format each alert with severity, description, and link
      const formattedAlert = `**${alert.secret_type_display_name?.toUpperCase()} SECRET FOUND** - [Details](${alert.html_url})`;
      
      if (
        maxAlerts > 0 &&
        alertCount > maxAlerts &&
        !isFileInPR
      ) {
        breakingAlerts.push(formattedAlert);
      } else if (!isFileInPR) {
        nonBreakingAlerts.push(formattedAlert);
      }
      if (
        maxAlerts > 0 &&
        alertCount > maxAlerts &&
        isFileInPR
      ) {
        breakingAlertsPRFiles.push(formattedAlert);
        disregardAlerts.push(alerts.indexOf(alert));
        alertCount = alertCount - 1;
      } else if (isFileInPR) {
        nonBreakingAlertsPRFiles.push(formattedAlert);
        disregardAlerts.push(alerts.indexOf(alert));
        alertCount = alertCount - 1;
      }
    };

    // Remove alerts that are part of the PR
    // alerts = alerts.filter((_, index) => !disregardAlerts.includes(index));

    // Prepare output summary dynamically
    const summaryLines = `- **SECRET** Total Alerts: ${alertCount}, Threshold: ${
      maxAlerts < 0
        ? "Notify only"
        : `Breaks when > ${maxAlerts}`
    }`;

    // Prepare output summary
    const summaryTitleSuccess = `# 🟢 SecretScanning Alerts (Main Branch) 🟢`;
    const summaryTitleFailure = `# 🔴 SecretScanning Alerts (Main Branch) 🔴`;

    // BEGIN: Define helper variable for summary breakingMessage
    const breakingMessage =
      breakingAlerts.length > 0
        ? `
## Please address these issues before merging this PR:
${breakingAlerts.join("\n")}
        `
        : "";
    // END: Define helper variable for summary breakingMessage
    // BEGIN: Define helper variable for summary nonBreakingMessage
    const nonBreakingMessage =
      nonBreakingAlerts.length > 0
        ? `
## Please consider these issues for the upcoming service update, the next release maybe blocked until solution:
${nonBreakingAlerts.join("\n")}
        `
        : "";
    // END: Define helper variable for summary nonBreakingMessage
    // BEGIN: Define helper variable for summary breakingMessagePRFiles
    const breakingMessagePRFiles =
      breakingAlertsPRFiles.length > 0 || nonBreakingAlertsPRFiles.length > 0
        ? `
### The following alerts are for files that are part of this PR, because of this their status on main are not being validated, but take in consideration that if the fixes are not being done, the next release maybe blocked until solution:
${breakingAlertsPRFiles.join("\n")}
${nonBreakingAlertsPRFiles.join("\n")}
        `
        : "";
    //  END: Define helper variable for summary breakingMessagePRFiles

    // BEGIN: Define summary message
    const summary = `
${alertCount > maxAlerts ? summaryTitleFailure : summaryTitleSuccess}

## Summary

${summaryLines}${breakingMessage.length > 0 ? breakingMessage : ""}${nonBreakingMessage.length > 0 ? nonBreakingMessage : ""}${breakingMessagePRFiles.length > 0 ? breakingMessagePRFiles : ""}`;
    // END: Define summary message

    let conclusion: "failure" | "success";
    conclusion = "success";
    if (alertCount > maxAlerts && maxAlerts >= 0) {
        conclusion = "failure";
    }

    // Declares the final summary message
    const commentIdentifier = "<!-- Secret Scanning Alerts Comment -->"; // Unique identifier
    const footerMessage = `\n[Go to SecretScanning](https://github.com/${owner}/${repo}/security/secret-scanning).`; // Footer message
    const maxCommentLength = 65530; // Maximum comment length

    let body = `${commentIdentifier}\n${summary}`;
    let bodyWithFooter = `${body}${footerMessage}`;

    // Check if comment exceeds the maximum length
    if (bodyWithFooter.length > maxCommentLength) {
      const truncatedMessage = `\n**Truncated:** ${footerMessage}`;
      // Truncate the body and add the see more details link
      body = `${commentIdentifier}\n${body.slice(0, maxCommentLength - truncatedMessage.length - commentIdentifier.length)}...\n${truncatedMessage}`;
    }
    else {
      body = bodyWithFooter;
    }

    // Action Summary logic
    // core.summary.addHeading("Secret Scanning Alerts Summary");
    // core.summary.addRaw(body, true);
    // await core.summary.write({ overwrite: true });

    // Comment logic
    if (prNumber) {
      // Get all PR Comments
      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
      });

      // Looks for a comment created by this Action
      const existingComment = comments.find((comment) =>
        comment.body?.startsWith(commentIdentifier),
      );

      if (existingComment) {
        // Updates the existing comment
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existingComment.id,
          body: `${body}`,
        });
        core.info(
          `Updated existing comment (ID: ${existingComment.id}) on PR #${prNumber}`,
        );
      } else {
        // Creates a new comment
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: `${body}`,
        });
        core.info(`Created a new comment on PR #${prNumber}`);
      }
    } else {
      core.info("No PR number found. Skipping comment creation.");
    }

    // Set outputs for the action
    core.setOutput("total_filtered_alerts", alertCount);
    core.setOutput("total_alerts", alerts.length);

    if (printSummary) {
      core.info(`summary: ${summary}`);
    }

    core.setOutput("conclusion", conclusion);

    if (conclusion == "success") {
      core.info("Code Scanning Alerts threshold not exceeded");
    } else {
      core.setFailed("Code scanning alerts exceed the allowed thresholds");
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}
