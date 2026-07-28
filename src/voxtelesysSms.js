import axios from "axios";

// Voxtelesys Messaging API is separate from 3CX's own SMS trunk config -- a
// number that works fine for inbound SMS through 3CX is not automatically a
// valid "from" sender here; it must be registered with Voxtelesys for
// outbound Messaging API use (confirmed 2026-07-28: +19163477001 works fine
// inbound via 3CX but 404s "from not found" here, while +19166643391 works).
export async function sendSms(config, to, body) {
    const { voxtelesysSmsApiUrl, voxtelesysSmsApiKey, voxtelesysSmsFromNumber } = config.missedCallSms;
    await axios.post(
        voxtelesysSmsApiUrl,
        {
            to: [to],
            from: voxtelesysSmsFromNumber,
            body
        },
        {
            headers: {
                Authorization: `Bearer ${voxtelesysSmsApiKey}`,
                "Content-Type": "application/json"
            },
            timeout: 15_000
        }
    );
}
