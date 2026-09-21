/** A seeded user as returned by GET /auth/users */
export interface UserListItem {
  id: string;
  name: string;
  email: string;
  role: 'MANAGER' | 'MEMBER';
  organizationId: string;
  organizationName: string;
}

/** The authenticated caller as returned by GET /auth/me */
export interface CurrentUser {
  id: string;
  name: string;
  role: 'MANAGER' | 'MEMBER';
  organizationId: string;
  organizationName?: string;
}

/** A single survey question */
export interface Question {
  id: string;
  text: string;
  type: 'RATING' | 'YES_NO';
  orderIndex: number;
}

/** The active survey as returned by GET /surveys/active */
export interface ActiveSurvey {
  id: string;
  title: string;
  questions: Question[];
}

/** One answer in a response submission */
export interface AnswerPayload {
  questionId: string;
  ratingValue?: number;
  yesNoValue?: boolean;
}

/** The result of a successful response submission */
export interface SubmitResult {
  id: string;
  surveyId: string;
  userId: string;
  weekKey: string;
  createdAt: string;
}
