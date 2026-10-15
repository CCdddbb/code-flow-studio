// Fields are synthetic; no credentials, tenant IDs or real records.
public record SubmitRequest(String draftId, String submitKey, int revision) {}
