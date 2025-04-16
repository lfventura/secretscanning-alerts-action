# Secret Scanning Alerts Action

This repository contains a GitHub Action for checking secret scanning alerts in your repositories. It helps automate the process of identifying and responding to potential security risks caused by exposed secrets.

## Features

- Checks open secret scanning alerts open
- Validates alerts against configurable thresholds
- Works with both Pull Request workflows and direct commit workflows.
- Updates or creates a **Comment** in GitHub with the results.
- Allows skipping failures in Pull Requests with the `do_not_break_pr_check` option.

## Inputs

The following inputs can be configured in the workflow:

| Input                  | Description                                                                 | Required | Default                          |
|------------------------|---------------------------------------------------------------------------|----------|----------------------------------|
| `github_token`         | The GitHub token used to authenticate API requests. It needs to be a PAT token with the `dependabot` read scope.                      | No       | `${{ github.token }}`           |
| `owner`                | The owner of the repository.                                               | No       | `${{ github.repository_owner }}`|
| `repo`                 | The name of the repository.                                                | No       | `${{ github.event.repository.name }}` |
| `max_alerts`      | Maximum allowed alerts. Set to -1 to only notify                                     | No       | None (will only notify but will not break)                             |
| `do_not_break_pr_check`| Do not fail the PR check if thresholds are exceeded.                       | No       | `false`                          |

---

## Outputs

The following outputs are provided by the Action:

| Output             | Description                                    |
|--------------------|----------------------------------------------|
| `total_filtered_alerts`| Number of detected alerts that does not get in exclusion criterias. |
| `total_alerts`  | Number of all alerts.           |
| `conclusion`      | Is this check a final success or a final failure?   |

## Usage

To use this action, include it in your GitHub Actions workflow:

```yaml
name: Secret Scanning Alerts

on:
    pull_request:
        branches:
            - main

jobs:
    scan-secrets:
        runs-on: ubuntu-latest
        steps:
            - name: Checkout code
                uses: actions/checkout@v3

            - name: Run Secret Scanning Alerts Action
                uses: lfventura/secretscanning-alerts-action@v1
                with:
                    # Add any required inputs here
```

## Results

### GitHub Display

- A **Check Run** will be created or updated in GitHub with the name `SecretScanning Alerts`.
- The result will be displayed directly in the Pull Request interface or in the commit history.

### Possible Conclusions

- **`success`**: No alerts exceed the configured thresholds.
- **`failure`**: Alerts exceed the configured thresholds.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.

## Support

If you encounter any issues, feel free to open a GitHub issue in this repository.