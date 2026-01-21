import {TRANSITION_MATRICES, shuffleTransitionMatrix} from "./modules/matrices.js";

const EXPERIMENT_CONFIG = {
	datapipe_id: "Sz1Mxzs1KPOg",
	matrix_size: null, // Will be randomly assigned: 4, 5, 6, 7, or 8
	transition_matrix: null, // To be set based on assigned matrix size
	sequence: [], // Full sequence for all blocks
	key_mapping: null, // To be set based on assigned matrix size
	n_blocks: 3,
	trials_per_block: null, // 10x matrix size for sufficient learning
	practice_trials: null, // 2x matrix size for practice
	rsi: 120, // ms
	error_feedback_duration: 200,
	error_tone_duration: 100,
	correct_feedback_duration: 200,
	block_break_duration: 15000,
	estimated_trial_duration: 500, // ms (for estimating total experiment time)
	start_time: null, // To be set at experiment start
};

// Matrices are pre-sorted by entropy (Position 0 = lowest, Position N-1 = highest)
const MATRICES = {
	4: TRANSITION_MATRICES[4].matrix,
	5: TRANSITION_MATRICES[5].matrix,
	6: TRANSITION_MATRICES[6].matrix,
	7: TRANSITION_MATRICES[7].matrix,
	8: TRANSITION_MATRICES[8].matrix,
};

// Key mappings (position index -> keyboard key)
const KEY_MAPPINGS_4 = ["d", "f", "j", "k"];
const KEY_MAPPINGS_5 = ["s", "d", "f", "j", "k"];
const KEY_MAPPINGS_6 = ["s", "d", "f", "j", "k", "l"];
const KEY_MAPPINGS_7 = ["a", "s", "d", "f", "j", "k", "l"];
const KEY_MAPPINGS_8 = ["a", "s", "d", "f", "j", "k", "l", ";"];

const KEY_MAPPINGS = {
	4: KEY_MAPPINGS_4,
	5: KEY_MAPPINGS_5,
	6: KEY_MAPPINGS_6,
	7: KEY_MAPPINGS_7,
	8: KEY_MAPPINGS_8,
};

let experimentState = {
	currentBlock: 0,
	currentTrial: 0,
	trialData: [],
};

function randomChoice(array, probabilities) {
	const random = Math.random();
	let cumsum = 0;
	for (let i = 0; i < array.length; i++) {
		cumsum += probabilities[i];
		if (random < cumsum) {
			return array[i];
		}
	}
	return array[array.length - 1];
}

function generateSequence(matrix, nTrials) {
	const sequence = [];
	const nStates = matrix.length;

	// Start from random position
	let currentPos = Math.floor(Math.random() * nStates);
	sequence.push(currentPos);

	// Generate remaining trials
	for (let i = 1; i < nTrials; i++) {
		const transitionProbs = matrix[currentPos];
		const positions = Array.from({length: nStates}, (_, i) => i);
		currentPos = randomChoice(positions, transitionProbs);
		sequence.push(currentPos);
	}

	return sequence;
}

function createStimulusDisplay(
	position = null,
	matrixSize,
	showKeys = false,
	feedbackMessage = "",
	blockNum = 0, // TEMPORARY: Add block number parameter for testing
) {
	let html = '<div class="feedback-message">';
	if (feedbackMessage) {
		html += feedbackMessage;
	}
	html += "</div>";

	// TEMPORARY: Testing conditions
	// Practice (blockNum = -1): no gap, no finger diagram
	// Block 0: no gap, no finger diagram
	// Block 1: gap, no finger diagram
	// Block 2: no gap, finger diagram
	const showGap = blockNum === 1;
	const showFingerDiagram = blockNum === 2;

	// Determine the split point between left and right hands
	// Left hand: A, S, D, F (max 4 keys)
	// Right hand: J, K, L, ; (max 4 keys)
	// 4: 2L|2R, 5: 3L|2R, 6: 3L|3R, 7: 4L|3R, 8: 4L|4R
	const leftHandCount = Math.ceil(matrixSize / 2);
	const lastLeftIndex = leftHandCount - 1;

	html += '<div class="stimulus-container">';
	for (let i = 0; i < matrixSize; i++) {
		const active = i === position ? "active" : "";
		const gapClass = i === lastLeftIndex && showGap ? "hand-gap" : "";
		html += `<div class="position-wrapper ${gapClass}">`;
		if (showKeys) {
			html += `<div class="key-label">${KEY_MAPPINGS[matrixSize][i].toUpperCase()}</div>`;
		}
		html += `<div class="position-box ${active}" data-position="${i}"></div>`;
		html += "</div>";
	}
	html += "</div>";

	// Add finger diagram below the boxes (only for block 2)
	if (showFingerDiagram) {
		html += `<div class="finger-diagram-container">
			<img src="assets/finger-diagrams/finger-diagram-${matrixSize}pos.png" alt="Finger position guide" class="finger-diagram" />
		</div>`;
	}

	return html;
}

// Add keypress visual feedback
function setupKeyPressHandlers(matrixSize) {
	const keyMapping = KEY_MAPPINGS[matrixSize];

	// Remove any existing handlers to avoid duplicates
	document.removeEventListener("keydown", window.keyDownHandler);
	document.removeEventListener("keyup", window.keyUpHandler);

	// Create new handlers
	window.keyDownHandler = function (e) {
		const keyIndex = keyMapping.indexOf(e.key.toLowerCase());
		if (keyIndex !== -1) {
			const boxes = document.querySelectorAll(".position-box");
			if (boxes[keyIndex]) {
				boxes[keyIndex].classList.add("pressed");
			}
		}
	};

	window.keyUpHandler = function (e) {
		const keyIndex = keyMapping.indexOf(e.key.toLowerCase());
		if (keyIndex !== -1) {
			const boxes = document.querySelectorAll(".position-box");
			if (boxes[keyIndex]) {
				boxes[keyIndex].classList.remove("pressed");
			}
		}
	};

	// Attach the handlers
	document.addEventListener("keydown", window.keyDownHandler);
	document.addEventListener("keyup", window.keyUpHandler);
}

function playErrorTone() {
	const audioContext = new (window.AudioContext || window.webkitAudioContext)();
	const oscillator = audioContext.createOscillator();
	const gainNode = audioContext.createGain();

	oscillator.connect(gainNode);
	gainNode.connect(audioContext.destination);

	oscillator.frequency.value = 200; // Low frequency for error
	oscillator.type = "sine";

	gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
	gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

	oscillator.start(audioContext.currentTime);
	oscillator.stop(audioContext.currentTime + 0.1);
}

async function initializeExperiment() {
	// Generate subject ID
	EXPERIMENT_CONFIG.subject_id = jsPsych.randomization.randomID(10);

	// TEMPORARY: Force matrix size to 7 for testing
	EXPERIMENT_CONFIG.matrix_size = 7;

	// Randomly assign matrix size
	// const matrixSizes = [4, 5, 6, 7, 8];
	// const condition = await jsPsychPipe.getCondition(EXPERIMENT_CONFIG.datapipe_id); // 0-4
	// EXPERIMENT_CONFIG.matrix_size = matrixSizes[condition]; // Update config with assigned matrix size

	// Load transition matrix and shuffle it
	const originalMatrix = MATRICES[EXPERIMENT_CONFIG.matrix_size];
	EXPERIMENT_CONFIG.transition_matrix = shuffleTransitionMatrix(originalMatrix);
	// Note: key_mapping in config is just for storage, still use KEY_MAPPINGS[size] for access
	EXPERIMENT_CONFIG.key_mapping = KEY_MAPPINGS[EXPERIMENT_CONFIG.matrix_size];

	// Set trials_per_block and practice_trials based on matrix size
	EXPERIMENT_CONFIG.trials_per_block = EXPERIMENT_CONFIG.matrix_size * 10; // 10x matrix size for sufficient learning
	EXPERIMENT_CONFIG.practice_trials = EXPERIMENT_CONFIG.matrix_size * 2; // 2x matrix size for practice

	// Generate full sequence for all blocks
	EXPERIMENT_CONFIG.total_trials = EXPERIMENT_CONFIG.n_blocks * EXPERIMENT_CONFIG.trials_per_block;
	EXPERIMENT_CONFIG.sequence = generateSequence(
		EXPERIMENT_CONFIG.transition_matrix,
		EXPERIMENT_CONFIG.total_trials,
	);
	EXPERIMENT_CONFIG.start_time = Date.now();

	console.log("Experiment initialized:", {
		matrixSize: EXPERIMENT_CONFIG.matrix_size,
		totalTrials: EXPERIMENT_CONFIG.total_trials,
	});
}

const jsPsych = initJsPsych({
	on_finish: function () {
		// Data is already saved via DataPipe, no need to display it
		// Experiment properties are added in runExperiment() before trials start
	},
});

let timeline = [];

// FULSCREEN
const enter_fullscreen = {
	type: jsPsychFullscreen,
	fullscreen_mode: true,
	data: {
		phase: "fullscreen",
	},
};

// Instructions
const instructions = {
	type: jsPsychInstructions,
	pages: function () {
		const size = EXPERIMENT_CONFIG.matrix_size;
		const keyElements = KEY_MAPPINGS[size]
			.map((k) => `<span class="inline-key">${k}</span>`)
			.join(" ");

		return [
			`<div class="instruction-text">
                <h1>Welcome!</h1>
                <p>Thank you for participating in this study.</p>
                <p>Please make sure you:</p>
                <ul>
                    <li>Are in a quiet environment</li>
                    <li>Will not be interrupted</li>
                    <li>Can use a physical keyboard (not touchscreen)</li>
					<li><strong>Are using a standard QWERTY keyboard</strong></li>
					<ul>
						<li>If you are using a different keyboard layout (e.g., AZERTY, DVORAK), please consider quitting the experiment or switching to a QWERTY keyboard as it might affect your performance.</li>
					</ul>
                    <li>Have your sound on</li>
                </ul>
                <p><strong>Click 'Next' to continue.</strong></p>
            </div>`,
			`<div class="instruction-text">
                    <h2>Instructions</h2>
					<p>In each trial, you will see ${EXPERIMENT_CONFIG.matrix_size} boxes arranged in a horizontal line on the screen.</p>
					<p>One of the boxes will have a mole  <img src="assets/mole.png" class="mole-image" alt="mole" style="vertical-align: middle;"> appear in it.</p>
					<p>Your task is to respond to the appearance of the mole by pressing a corresponding key on your keyboard as quickly and accurately as possible.</p>
					<p>The set of keys you will use to respond are:<br>${keyElements}.</p>
					<p>These keys correspond to the boxes on the screen in a left-to-right order. So, if the mole appears in the leftmost box, you would press the leftmost key <span class="inline-key">${KEY_MAPPINGS[size][0]}</span>; if it appears in the second box from the left, you would press <span class="inline-key">${KEY_MAPPINGS[size][1]}</span>, and so on.</p>
                    <img src="assets/key-mappings-${EXPERIMENT_CONFIG.matrix_size}pos.gif" alt="Key Mapping" class="key-mapping-image" />
                    <p>The keys match the horizontal order of the boxes on the screen while following a natural left-to-right hand position on the keyboard.</p>
					<p><strong>Please rest your fingers on these keys throughout the task, as demonstrated above.</strong></p>
                </div>`,

			`<div class="instruction-text">
                    <h2>Feedback</h2>
                    <p>After each response, you will be given feedback on whether you pressed the right key.</p>
                    <p>If you made an error, you will be told to try again until you press the correct key.</p>
                    <p>Just try to stay focused and respond as quickly as possible!</p>
                </div>`,

			`<div class="instruction-text">
                    <h2>Practice</h2>
                    <p>You wil start with ${EXPERIMENT_CONFIG.practice_trials} practice trials to get familiar with the task.</p>
                    <p><strong>Ready to practice?</strong></p>
                </div>`,
		];
	},
	show_clickable_nav: true,
	data: {
		phase: "instructions",
	},
};

// Practice trials
function createPracticeTrial(position, trialIndex) {
	const size = EXPERIMENT_CONFIG.matrix_size;
	const correctKey = KEY_MAPPINGS[size][position];

	// Correction loop - repeats until correct response
	const correctionLoop = {
		timeline: [
			{
				// Practice stimulus
				type: jsPsychHtmlKeyboardResponse,
				stimulus: function () {
					return createStimulusDisplay(position, size, true, "", -1); // -1 for practice
				},
				choices: "ALL_KEYS",
				data: {
					phase: "practice_stimulus",
					trial_index: trialIndex,
					position: position,
					correct_key: correctKey,
				},
				on_load: function () {
					setupKeyPressHandlers(size);
				},
				on_finish: function (data) {
					data.correct = data.response === correctKey;
				},
			},
			{
				// Feedback
				type: jsPsychHtmlKeyboardResponse,
				stimulus: function () {
					const lastTrial = jsPsych.data.get().last(1).values()[0];
					let feedbackHTML = "";
					if (lastTrial.correct) {
						feedbackHTML = '<div class="feedback-correct">✓</div>';
					} else {
						feedbackHTML = '<div class="feedback-error">✗<br>Try again!</div>';
					}
					return createStimulusDisplay(position, size, true, feedbackHTML, -1);
				},
				choices: "NO_KEYS",
				trial_duration: function () {
					const lastTrial = jsPsych.data.get().last(1).values()[0];
					return lastTrial.correct
						? EXPERIMENT_CONFIG.correct_feedback_duration
						: EXPERIMENT_CONFIG.error_feedback_duration;
				},
				data: {
					phase: "practice_feedback",
				},
				on_start: function () {
					const lastTrial = jsPsych.data.get().last(1).values()[0];
					if (!lastTrial.correct) {
						playErrorTone();
					}
				},
			},
		],
		loop_function: function () {
			const lastTrial = jsPsych.data.get().last(2).values()[0]; // Get the stimulus trial (2 back because feedback is last)
			return !lastTrial.correct; // Loop if incorrect
		},
	};

	// RSI after correct response
	const rsi = {
		type: jsPsychHtmlKeyboardResponse,
		stimulus: function () {
			return createStimulusDisplay(null, size, true, "", -1);
		},
		choices: "NO_KEYS",
		trial_duration: EXPERIMENT_CONFIG.rsi,
		data: {
			phase: "practice_rsi",
		},
	};

	return {
		timeline: [correctionLoop, rsi],
	};
}

// Main task trial with feedback
function createMainTrial(position, blockNum, trialInBlock, overallTrial) {
	const size = EXPERIMENT_CONFIG.matrix_size;
	const correctKey = KEY_MAPPINGS[size][position];

	// Track whether an error has occurred
	let hasError = false;

	// Correction loop - repeats until correct response
	const correctionLoop = {
		timeline: [
			{
				// Main stimulus
				type: jsPsychHtmlKeyboardResponse,
				stimulus: function () {
					// Show keys if there was an error, otherwise hide them
					return createStimulusDisplay(position, size, hasError, "", blockNum);
				},
				choices: "ALL_KEYS",
				data: {
					phase: "main_stimulus",
					block: blockNum,
					trial_in_block: trialInBlock,
					overall_trial: overallTrial,
					position: position,
					correct_key: correctKey,
					matrix_size: size,
				},
				on_load: function () {
					setupKeyPressHandlers(size);
				},
				on_finish: function (data) {
					data.correct = data.response === correctKey;

					// Store in experiment state (only first response per trial)
					const trialsAtThisPosition = experimentState.trialData.filter(
						(t) => t.block === blockNum && t.trial === trialInBlock,
					);
					if (trialsAtThisPosition.length === 0) {
						experimentState.trialData.push({
							block: blockNum,
							trial: trialInBlock,
							position: position,
							response: data.response,
							rt: data.rt,
							correct: data.correct,
						});
					}
				},
			},
			{
				// Feedback
				type: jsPsychHtmlKeyboardResponse,
				stimulus: function () {
					const lastTrial = jsPsych.data.get().last(1).values()[0];
					let feedbackHTML = "";
					if (lastTrial.correct) {
						feedbackHTML = '<div class="feedback-correct">✓</div>';
						hasError = false; // Reset error flag on correct response
					} else {
						feedbackHTML = '<div class="feedback-error">✗<br>Try again!</div>';
						hasError = true; // Set error flag
					}
					// Show keys in feedback if there's an error
					return createStimulusDisplay(position, size, !lastTrial.correct, feedbackHTML, blockNum);
				},
				choices: "NO_KEYS",
				trial_duration: function () {
					const lastTrial = jsPsych.data.get().last(1).values()[0];
					return lastTrial.correct
						? EXPERIMENT_CONFIG.correct_feedback_duration
						: EXPERIMENT_CONFIG.error_feedback_duration;
				},
				data: {
					phase: "main_feedback",
				},
				on_start: function () {
					const lastTrial = jsPsych.data.get().last(1).values()[0];
					if (!lastTrial.correct) {
						playErrorTone();
					}
				},
			},
		],
		loop_function: function () {
			const lastTrial = jsPsych.data.get().last(2).values()[0]; // Get the stimulus trial (2 back because feedback is last)
			return !lastTrial.correct; // Loop if incorrect
		},
	};

	// RSI after correct response
	const rsi = {
		type: jsPsychHtmlKeyboardResponse,
		stimulus: function () {
			return createStimulusDisplay(null, size, false, "", blockNum);
		},
		choices: "NO_KEYS",
		trial_duration: EXPERIMENT_CONFIG.rsi,
		data: {
			phase: "main_rsi",
		},
	};

	return {
		timeline: [correctionLoop, rsi],
	};
}

// Block break with feedback
function createBlockBreak(blockNum) {
	return {
		type: jsPsychHtmlButtonResponse,
		stimulus: function () {
			// Calculate block statistics
			const blockTrials = experimentState.trialData.filter((t) => t.block === blockNum - 1);
			const accuracy = (
				(blockTrials.filter((t) => t.correct).length / blockTrials.length) *
				100
			).toFixed(1);
			const meanRT = (
				blockTrials.filter((t) => t.correct).reduce((sum, t) => sum + t.rt, 0) /
				blockTrials.filter((t) => t.correct).length
			).toFixed(0);

			// Adaptive feedback
			let feedback = "";
			if (accuracy < 50) {
				feedback = '<p style="color: #f44336;"><strong>Try to be more accurate.</strong></p>';
			} else if (meanRT > 1000) {
				feedback = '<p style="color: #2196F3;"><strong>Try to respond faster!</strong></p>';
			} else {
				feedback = '<p style="color: #4CAF50;"><strong>Great job! Keep it up!</strong></p>';
			}

			const progress = ((blockNum / EXPERIMENT_CONFIG.n_blocks) * 100).toFixed(0);

			return `
                    <div class="block-feedback">
                        <h2>Block ${blockNum} of ${EXPERIMENT_CONFIG.n_blocks} Complete!</h2>

                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: ${progress}%"></div>
                        </div>

                        <p><strong>Current Block:</strong></p>
                        <p>You got ${accuracy}% of the trials correct.</p>

                        ${feedback}

                        <p style="margin-top: 30px;">Feel free to take a break.</p>
                        <p style="font-size: 14px; color: #666;">Click the button below when you're ready to continue.</p>
                    </div>
                `;
		},
		choices: ["Continue"],
		data: {
			phase: "block_break",
		},
	};
}

// Final feedback after last block
function createFinalFeedback() {
	return {
		type: jsPsychHtmlButtonResponse,
		stimulus: function () {
			// Record end time when last block completes
			EXPERIMENT_CONFIG.end_time = Date.now();

			// Calculate final block statistics
			const finalBlock = EXPERIMENT_CONFIG.n_blocks - 1;
			const blockTrials = experimentState.trialData.filter((t) => t.block === finalBlock);
			const accuracy = (
				(blockTrials.filter((t) => t.correct).length / blockTrials.length) *
				100
			).toFixed(1);
			const meanRT = (
				blockTrials.filter((t) => t.correct).reduce((sum, t) => sum + t.rt, 0) /
				blockTrials.filter((t) => t.correct).length
			).toFixed(0);

			// Adaptive feedback
			let feedback = "";
			if (accuracy < 85) {
				feedback = '<p style="color: #f44336;"><strong>Try to be more accurate.</strong></p>';
			} else if (meanRT > 1000) {
				feedback = '<p style="color: #2196F3;"><strong>Try to respond faster!</strong></p>';
			} else {
				feedback = '<p style="color: #4CAF50;"><strong>Great job! Keep it up!</strong></p>';
			}

			return `
                    <div class="block-feedback">
                        <h2>All Blocks Complete!</h2>

                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: 100%"></div>
                        </div>

                        <p><strong>Final Block:</strong></p>
                        <p>You got ${accuracy}% of the trials correct.</p>

                        ${feedback}

                        <p style="margin-top: 30px;">Thank you for completing all the trials!</p>
                        <p style="font-size: 14px; color: #666;">Click continue to proceed to a few final questions.</p>
                    </div>
                `;
		},
		choices: ["Continue"],
		data: {
			phase: "final_feedback",
		},
		on_finish: function () {
			// Add end_time to all data rows
			jsPsych.data.addProperties({
				end_time: EXPERIMENT_CONFIG.end_time,
			});
		},
	};
}

// Post-task questionnaire

// Q1: Open probe
const q1_open_probe = {
	type: jsPsychSurveyMultiChoice,
	questions: [
		{
			prompt: "Did you notice anything special about the task?",
			name: "q1_open_probe",
			options: ["No", "Yes"],
			required: true,
		},
	],
	data: {
		phase: "questionnaire",
		questionnaire_item: "q1_open_probe",
	},
};

// Q1b: If yes, describe what they noticed
const q1b_describe_special = {
	timeline: [
		{
			type: jsPsychSurveyText,
			questions: [
				{
					prompt: "What did you notice?",
					name: "q1b_describe_special",
					rows: 4,
					required: true,
				},
			],
			data: {
				phase: "questionnaire",
				questionnaire_item: "q1b_describe_special",
			},
		},
	],
	conditional_function: function () {
		const lastResponse = jsPsych.data.get().last(1).values()[0];
		return lastResponse.response.q1_open_probe === "Yes";
	},
};

// Q2: Direct pattern question
const q2_noticed_regularity = {
	type: jsPsychSurveyMultiChoice,
	questions: [
		{
			prompt: "Did you notice any regularity in where the mole appeared?",
			name: "q2_noticed_regularity",
			options: ["No", "Yes"],
			required: true,
		},
	],
	data: {
		phase: "questionnaire",
		questionnaire_item: "q2_noticed_regularity",
	},
};

// Q2b: If yes, describe the regularity
const q2b_describe_regularity = {
	timeline: [
		{
			type: jsPsychSurveyText,
			questions: [
				{
					prompt: "Can you describe the regularity?",
					name: "q2b_describe_regularity",
					rows: 4,
					required: true,
				},
			],
			data: {
				phase: "questionnaire",
				questionnaire_item: "q2b_describe_regularity",
			},
		},
	],
	conditional_function: function () {
		const lastResponse = jsPsych.data.get().last(1).values()[0];
		return lastResponse.response.q2_noticed_regularity === "Yes";
	},
};

// Q2c: Confidence (THIS IS KEY)
const q2c_confidence = {
	timeline: [
		{
			type: jsPsychSurveyLikert,
			questions: [
				{
					prompt: "How confident are you that there was a regularity?",
					name: "q2c_confidence",
					labels: ["1<br>Not at all", "2", "3", "4", "5<br>Very confident"],
					required: true,
				},
			],
			data: {
				phase: "questionnaire",
				questionnaire_item: "q2c_confidence",
			},
		},
	],
	conditional_function: function () {
		const lastResponse = jsPsych.data.get().last(1).values()[0];
		return lastResponse.response.q2_noticed_regularity === "Yes";
	},
};

// Q3: Strategy
const q3_strategy = {
	type: jsPsychSurveyMultiChoice,
	questions: [
		{
			prompt: "Did you use any strategy to help you respond faster?",
			name: "q3_strategy",
			options: ["No", "Yes"],
			required: true,
		},
	],
	data: {
		phase: "questionnaire",
		questionnaire_item: "q3_strategy",
	},
};

// Q3b: If yes, describe the strategy
const q3b_describe_strategy = {
	timeline: [
		{
			type: jsPsychSurveyText,
			questions: [
				{
					prompt: "Can you describe the strategy?",
					name: "q3b_describe_strategy",
					rows: 4,
					required: true,
				},
			],
			data: {
				phase: "questionnaire",
				questionnaire_item: "q3b_describe_strategy",
			},
		},
	],
	conditional_function: function () {
		const lastResponse = jsPsych.data.get().last(1).values()[0];
		return lastResponse.response.q3_strategy === "Yes";
	},
};

// Q4: Forced description
const q4_forced_description = {
	type: jsPsychSurveyText,
	questions: [
		{
			prompt: "There WAS a regularity in the sequence. What do you think it was?",
			name: "q4_forced_description",
			rows: 4,
			required: true,
		},
	],
	data: {
		phase: "questionnaire",
		questionnaire_item: "q4_forced_description",
	},
};

// Q4b: Confidence in guess
const q4b_confidence_guess = {
	type: jsPsychSurveyLikert,
	questions: [
		{
			prompt: "How confident are you in your answer?",
			name: "q4b_confidence_guess",
			labels: ["1<br>Not at all", "2", "3", "4", "5<br>Very confident"],
			required: true,
		},
	],
	data: {
		phase: "questionnaire",
		questionnaire_item: "q4b_confidence_guess",
	},
};

// Technical difficulties question
const q5_technical = {
	type: jsPsychSurveyText,
	questions: [
		{
			prompt:
				"Did you experience any technical difficulties, bugs, or issues during this experiment? If so, please describe them below. (This is a pilot testing phase, so your feedback is very helpful!)",
			name: "technical_difficulties",
			rows: 5,
			required: false,
		},
	],
	data: {
		phase: "questionnaire",
		questionnaire_item: "technical_difficulties",
	},
};

// Debrief
const debrief = {
	type: jsPsychHtmlButtonResponse,
	stimulus: `<div class="instruction-text">
                <h2>Thank You!</h2>
                <p>You have completed the experiment.</p>
                <p>This study investigates how people learn predictable patterns in sequences.</p>
                <p>Some positions had the mole appearing in more predictable locations,
                while others were more variable.</p>
                <p>Your data will help us understand how people learn these kinds of patterns.</p>
                <p>Thank you for your participation!</p>
            </div>`,
	choices: ["Close Window"],
	data: {
		phase: "debrief",
	},
	on_finish: function () {
		window.close();
	},
};

// Data saving
const save_data = (filename) => ({
	type: jsPsychPipe,
	action: "save",
	experiment_id: "Sz1Mxzs1KPOg",
	filename: filename,
	data_string: () => jsPsych.data.get().csv(),
	data: {
		phase: "save_data",
	},
});

// Run experiment (async wrapper to handle initialization)
async function runExperiment() {
	// Initialize experiment (this is async because it calls jsPsychPipe.getCondition)
	await initializeExperiment();
	const filename = `${EXPERIMENT_CONFIG.subject_id}.csv`;

	// Add experiment configuration to all data rows (must be done before trials run)
	jsPsych.data.addProperties({
		subject_id: EXPERIMENT_CONFIG.subject_id,
		matrix_size: EXPERIMENT_CONFIG.matrix_size,
		transition_matrix: JSON.stringify(EXPERIMENT_CONFIG.transition_matrix),
		sequence: JSON.stringify(EXPERIMENT_CONFIG.sequence),
		trials_per_block: EXPERIMENT_CONFIG.trials_per_block,
		total_trials: EXPERIMENT_CONFIG.total_trials,
		practice_trials: EXPERIMENT_CONFIG.practice_trials,
		start_time: EXPERIMENT_CONFIG.start_time,
	});

	// Preload media files
	const size = EXPERIMENT_CONFIG.matrix_size;
	const preload = {
		type: jsPsychPreload,
		images: [
			"assets/key-white.png",
			"assets/key-black.png",
			"assets/key-mole.png",
			`assets/key-mappings-${size}pos.gif`,
			`assets/finger-diagrams/finger-diagram-${size}pos.png`,
		],
		message: "Please wait while the experiment loads...",
		show_progress_bar: true,
		error_message: "The experiment failed to load. Please refresh the page.",
		data: {
			phase: "preload",
		},
	};

	// Add components to timeline
	timeline.push(preload);
	timeline.push(enter_fullscreen);
	timeline.push(instructions);

	// Practice block - ensure all positions are sampled exactly twice
	let practiceSequence = [];
	const nPositions = EXPERIMENT_CONFIG.matrix_size;

	// Create array with each position appearing exactly twice
	for (let pos = 0; pos < nPositions; pos++) {
		practiceSequence.push(pos);
		practiceSequence.push(pos);
	}

	// Shuffle the practice sequence
	practiceSequence = jsPsych.randomization.shuffle(practiceSequence);

	for (let i = 0; i < EXPERIMENT_CONFIG.practice_trials; i++) {
		timeline.push(createPracticeTrial(practiceSequence[i], i));
	}

	// Practice feedback
	timeline.push({
		type: jsPsychHtmlButtonResponse,
		stimulus: function () {
			const practiceData = jsPsych.data.get().filter({phase: "practice"});
			const accuracy = (
				(practiceData.filter({correct: true}).count() / practiceData.count()) *
				100
			).toFixed(1);

			return `
                <div class="instruction-text">
                    <h2>Practice Complete!</h2>
                    <p>You got ${accuracy}% of the trials correct.</p>
                    <p>Remember: Respond as quickly and accurately as possible.</p>
					<p>Now, you will complete ${EXPERIMENT_CONFIG.n_blocks} blocks of ${EXPERIMENT_CONFIG.trials_per_block} trials.</p>
                    <p>Between blocks, you will get a 15-second break to rest.</p>
                    <p>The entire task takes about ${Math.ceil((EXPERIMENT_CONFIG.n_blocks * EXPERIMENT_CONFIG.trials_per_block * (EXPERIMENT_CONFIG.estimated_trial_duration + EXPERIMENT_CONFIG.rsi) + EXPERIMENT_CONFIG.n_blocks * 15000) / 60000)} minutes.</p>
                    <p><strong>The main task will now begin.</strong></p>
                </div>
            `;
		},
		choices: ["Start Main Task"],
		data: {
			phase: "practice_end",
		},
	});

	// Main task blocks
	for (let block = 0; block < EXPERIMENT_CONFIG.n_blocks; block++) {
		for (let trial = 0; trial < EXPERIMENT_CONFIG.trials_per_block; trial++) {
			const overallTrial = block * EXPERIMENT_CONFIG.trials_per_block + trial;
			const position = EXPERIMENT_CONFIG.sequence[overallTrial];

			timeline.push(createMainTrial(position, block, trial, overallTrial));
		}

		// Block break (except after last block)
		if (block < EXPERIMENT_CONFIG.n_blocks - 1) {
			timeline.push(createBlockBreak(block + 1));
		}
	}

	// Final feedback after all blocks complete
	timeline.push(createFinalFeedback());

	// Post-task questionnaire
	timeline.push(q1_open_probe);
	timeline.push(q1b_describe_special);
	timeline.push(q2_noticed_regularity);
	timeline.push(q2b_describe_regularity);
	timeline.push(q2c_confidence);
	timeline.push(q3_strategy);
	timeline.push(q3b_describe_strategy);
	timeline.push(q4_forced_description);
	timeline.push(q4b_confidence_guess);
	timeline.push(q5_technical);

	// Data saving (after questionnaire, before debrief)
	timeline.push(save_data(filename));

	// Debrief
	timeline.push(debrief);

	// Run the experiment
	jsPsych.run(timeline);
}

// Start the experiment
runExperiment();
