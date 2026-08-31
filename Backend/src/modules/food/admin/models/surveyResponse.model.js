import mongoose from 'mongoose';

const surveyAnswerSchema = new mongoose.Schema(
    {
        questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
        answer: { type: mongoose.Schema.Types.Mixed, required: true },
    },
    { _id: false }
);

const surveyResponseSchema = new mongoose.Schema(
    {
        surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodSurvey', required: true, index: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodUser', required: true, index: true },
        // Written the moment the popup is shown, before any answer exists — this
        // is what makes "shown only once" hold even if the user dismisses it
        // without answering.
        shownAt: { type: Date, required: true },
        answeredAt: { type: Date, default: null },
        answers: { type: [surveyAnswerSchema], default: [] },
    },
    { collection: 'food_survey_responses', timestamps: true }
);

surveyResponseSchema.index({ surveyId: 1, userId: 1 }, { unique: true });

export const FoodSurveyResponse = mongoose.model('FoodSurveyResponse', surveyResponseSchema);
