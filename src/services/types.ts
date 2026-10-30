export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export type Status =
  | 'Pending Verification'
  | 'Pending Admin Review'
  | 'Approved'
  | 'Rejected'
  | 'Needs More Information'
  | 'Suspended';

export type VerificationState = 'verified' | 'unverified' | 'manual_review_required';
export type OwnershipState = 'confirmed' | 'not_confirmed' | 'not_checked';
export type ValuesSource = 'reddit_api' | 'admin_manual' | 'test_fixture';

export type TaskAppStatus = 'Applied' | 'Under Review' | 'Accepted' | 'Rejected' | 'Completed' | 'Cancelled';

export const ADMIN_PERMISSIONS = [
  'review_applications',
  'manage_tasks',
  'manage_users',
  'wallet_adjust',
  'manage_settings',
] as const;
export type Permission = (typeof ADMIN_PERMISSIONS)[number];

export interface SubmissionRow {
  id: string;
  user_id: string;
  profile_url: string;
  reddit_username: string;
  status: Status;
  verification_state: VerificationState;
  ownership_state: OwnershipState;
  values_source: ValuesSource | null;
  account_created_at: Date | null;
  comment_karma: number | null;
  post_karma: number | null;
  verified_at: Date | null;
  user_note: string | null;
  rejection_reason: string | null;
  allow_resubmit: boolean;
  info_request: string | null;
  suspension_reason: string | null;
  admin_notes: string | null;
  submitted_at: Date;
  updated_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  superseded_at: Date | null;
}
