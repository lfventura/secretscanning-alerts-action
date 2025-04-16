import * as core from "@actions/core";
import * as github from "@actions/github";
import { run } from "./run";

jest.mock("@actions/core");
jest.mock("@actions/github");

describe("run", () => {
    const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>;
    const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>;
    const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>;
    const mockInfo = core.info as jest.MockedFunction<typeof core.info>;
    const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;
    const mockGetOctokit = github.getOctokit as jest.MockedFunction<typeof github.getOctokit>;

    const mockContext = github.context;
    const mockOctokit = {
        paginate: jest.fn(),
        rest: {
            secretScanning: {
                listAlertsForRepo: jest.fn(),
            },
            pulls: {
                listFiles: jest.fn(),
            },
            issues: {
                listComments: jest.fn(),
                updateComment: jest.fn(),
                createComment: jest.fn(),
            },
        },
        request: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetInput.mockImplementation((name: string) => {
            const inputs: Record<string, string> = {
                github_token: "test-token",
                owner: "test-owner",
                repo: "test-repo",
                do_not_break_pr_check: "false",
                max_alerts: "5",
            };
            return inputs[name];
        });
        mockGetOctokit.mockReturnValue(mockOctokit as any);
        mockContext.payload = {};
    });

    it("should handle no alerts and succeed", async () => {
        mockOctokit.paginate.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        await run();

        expect(mockSetOutput).toHaveBeenCalledWith("total_alerts", 0);
        expect(mockSetOutput).toHaveBeenCalledWith("conclusion", "success");
        expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it("should handle alerts exceeding the threshold and fail", async () => {
        const alerts = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, html_url: "http://example.com", secret_type_display_name: "Test Secret" }));
        mockOctokit.paginate.mockResolvedValueOnce(alerts).mockResolvedValueOnce([]);

        await run();

        expect(mockSetOutput).toHaveBeenCalledWith("total_alerts", 10);
        expect(mockSetOutput).toHaveBeenCalledWith("conclusion", "failure");
        expect(mockSetFailed).toHaveBeenCalledWith("Code scanning alerts exceed the allowed thresholds");
    });

    it("should handle PR-specific alerts and disregard them", async () => {
        mockContext.payload.pull_request = { number: 123 } as any;
        const alerts = [
            { number: 1, html_url: "http://example.com", secret_type_display_name: "Test Secret", locations_url: "http://location.com" },
        ];
        const prFiles = [{ filename: "file1.js" }];
        const locations = [{ details: { path: "file1.js" } }];
        const comments = [{}];

        mockOctokit.paginate
            .mockResolvedValueOnce(alerts)
            .mockResolvedValueOnce([]);
        mockOctokit.paginate.mockImplementation((fn: any) => {
            if (fn === mockOctokit.rest.pulls.listFiles) {
                return Promise.resolve(prFiles);
            }
            return Promise.resolve([]);
            });
        mockOctokit.rest.pulls.listFiles.mockResolvedValueOnce({ data: prFiles });
        mockOctokit.request.mockResolvedValueOnce({ data: locations });
        mockOctokit.rest.issues.listComments.mockResolvedValueOnce({ data: comments });

        await run();

        expect(mockSetOutput).toHaveBeenCalledWith("total_alerts", 0);
        expect(mockSetOutput).toHaveBeenCalledWith("conclusion", "success");
        expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it("should handle API errors gracefully", async () => {
        mockOctokit.paginate.mockRejectedValueOnce(new Error("API Error"));

        await run();

        expect(mockSetFailed).toHaveBeenCalledWith("API Error");
    });

    it("should update an existing comment on a PR", async () => {
        mockContext.payload.pull_request = { number: 123 } as any;
        const alerts = [
            { number: 1, html_url: "http://example.com", secret_type_display_name: "Test Secret" },
        ];
        const comments = [
            { id: 1, body: "<!-- Secret Scanning Alerts Comment --> Existing comment" },
        ];
        const prFiles = [{ filename: "something.js" }];

        mockOctokit.paginate.mockResolvedValueOnce(alerts).mockResolvedValueOnce([]);
        mockOctokit.paginate.mockImplementation((fn: any) => {
            if (fn === mockOctokit.rest.pulls.listFiles) {
                return Promise.resolve(prFiles);
            }
            return Promise.resolve([]);
            });
        mockOctokit.rest.issues.listComments.mockResolvedValueOnce({ data: comments });

        await run();

        expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith({
            owner: "test-owner",
            repo: "test-repo",
            comment_id: 1,
            body: expect.stringContaining("**TOTAL** Alerts: 1"),
        });
    });

    it("should create a new comment on a PR if no existing comment is found", async () => {
        mockContext.payload.pull_request = { number: 123 } as any;
        const alerts = [
            { number: 1, html_url: "http://example.com", secret_type_display_name: "Test Secret" },
        ];
        const prFiles = [{ filename: "something.js" }];

        mockOctokit.paginate.mockResolvedValueOnce(alerts).mockResolvedValueOnce([]);
        mockOctokit.rest.issues.listComments.mockResolvedValueOnce({ data: [] });
        mockOctokit.paginate.mockImplementation((fn: any) => {
            if (fn === mockOctokit.rest.pulls.listFiles) {
                return Promise.resolve(prFiles);
            }
            return Promise.resolve([]);
            });

        await run();

        expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
            owner: "test-owner",
            repo: "test-repo",
            issue_number: 123,
            body: expect.stringContaining("**TOTAL** Alerts: 1"),
        });
    });
});