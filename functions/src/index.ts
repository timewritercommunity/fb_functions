import * as functions from "firebase-functions";

// The Firebase Admin SDK to access Firestore.
import * as admin from "firebase-admin";
admin.initializeApp();

exports.scheduledFunctionCrontab = functions
    .pubsub
    .schedule("* * * * *")
    .timeZone("Etc/UTC")
    .onRun(async (context: any) => {
        const configRef = admin.firestore()
            .collection("configs")
            .doc("active_day");
        const config = await configRef.get();
        const data = config.data();
        if (!data) {
            return;
        }

        if (!data.start_date) {
            return;
        }


        if (!(data.day || data.day === 0)) {
            console.log("Day not set");
            return;
        }

        if (data.start_date > admin.firestore.Timestamp.now()) {
            console.log("Date is still in future");
            return;
        }

        if (!data.runtime_hours) {
            console.log("No Runtime defined");
            return;
        }

        const runtimeHours = data.runtime_hours;

        const ts = admin.firestore.Timestamp.now()
            .toDate().getTime() - data.start_date.toDate().getTime();

        let time = (ts / 1000 / 60 / 60);
        if (time <= runtimeHours) {
            console.log("Not enough time has passed yet", time, "hours");
            return;
        }

        time = time % runtimeHours;
        const isSubmissionPeriod = time <= (runtimeHours / 2);
        if (!isSubmissionPeriod) {
            console.log("Wrong Period, Voting is active!");
            return;
        }

        const day = data.day;
        const voteRef = admin.firestore()
            .collection("votes")
            .where("day", "in", [day, -day]);

        const submissionMapFuture: any = {};
        const submissionMapPast: any = {};

        const votes = await voteRef.get();
        votes.forEach((vote) => {
            const v = vote.data();
            if (!(v.submission_id && v.weight)) {
                return;
            }

            if (v.day === day) {
                if (!submissionMapFuture[v.submission_id]) {
                    submissionMapFuture[v.submission_id] = 0;
                }

                submissionMapFuture[v.submission_id] += v.weight;
            } else if (v.day === -day) {
                if (!submissionMapPast[v.submission_id]) {
                    submissionMapPast[v.submission_id] = 0;
                }

                submissionMapPast[v.submission_id] += v.weight;
            }
        });

        let winningPast = "";
        let winningFuture = "";

        let maxFuture = 0;
        let maxPast = 0;
        Object.keys(submissionMapFuture).forEach((key) => {
            if (submissionMapFuture[key] >= maxFuture) {
                winningFuture = key;
                maxFuture = submissionMapFuture[key];
            }
        });

        Object.keys(submissionMapPast).forEach((key) => {
            if (submissionMapPast[key] >= maxPast) {
                winningPast = key;
                maxPast = submissionMapPast[key];
            }
        });

        if (!((winningFuture && winningPast) || (day === 0 && winningFuture))) {
            console.log("Nothing to do here!");
            return null;
        }


        if (!data) {
            configRef.create({ day: day + 1 });
        } else {
            configRef.update({ day: day + 1 });
        }

        const submissionFutureRef = admin.firestore()
            .collection("submissions")
            .doc(winningFuture);

        const submissionFuture = await submissionFutureRef.get();
        admin.firestore()
            .collection("stories").doc().create({ ...submissionFuture.data() });


        if (day === 0) {
            return null;
        }

        const submissionPastRef = admin.firestore()
            .collection("submissions")
            .doc(winningPast);

        const submissionPast = await submissionPastRef.get();
        admin.firestore()
            .collection("stories").doc().create({ ...submissionPast.data() });

        return null;
    });
