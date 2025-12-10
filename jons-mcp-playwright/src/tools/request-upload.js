/**
 * browser_request_upload tool schema
 *
 * Returns an upload URL and token for sandboxed environments to POST files
 * for use with browser_file_upload.
 */

export const schema = {
  name: 'browser_request_upload',
  description: `Request a URL to upload a file for use with browser_file_upload.

WORKFLOW for uploading files to a webpage:
1. Call this tool FIRST to get an upload URL and token
2. POST your file to the upload URL with header 'X-Upload-Token: <uploadToken>'
3. The response contains a fileToken
4. Click the upload button on the webpage (triggers file chooser)
5. Call browser_file_upload with fileTokens: [<fileToken>]

Use this for sandboxed environments that cannot access local file paths directly.`,
  inputSchema: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Expected filename for the upload (optional, used for organization)',
      },
      maxBytes: {
        type: 'number',
        description: 'Maximum file size in bytes (optional, defaults to 50MB)',
      },
    },
  },
};
