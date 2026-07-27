const SSN_DASHED_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const SSN_COMPACT_REGEX = /\b\d{9}\b/g;

export function sanitizeTranscriptText(transcript, config) {
    if (!config.transcriptRedaction.redactSsn) {
        return transcript;
    }
    return transcript
        .replaceAll(SSN_DASHED_REGEX, "[REDACTED-SSN]")
        .replaceAll(SSN_COMPACT_REGEX, "[REDACTED-SSN]");
}
