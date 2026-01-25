import {load} from "https://cdn.jsdelivr.net/npm/npyjs@latest/dist/index.js";

const EXPERIMENT_CONFIG = {
	datapipe_id: "Sz1Mxzs1KPOg",
	matrix_size: null, // Will be randomly assigned: 4, 5, 6, 7, or 8
	transition_matrix: null, // To be set based on assigned matrix size
	conditional_entropies: null, // To be set based on assigned shuffled matrix
	sequence: [], // Full sequence for all blocks
	key_mapping: null, // To be set based on assigned matrix size
	n_blocks: 7,
	trials_per_block: null, // 10x matrix size for sufficient learning
	practice_trials: null, // 2x matrix size for practice
	rsi: 120, // ms
	error_tone_duration: 100,
	error_feedback_duration: 200,
	correct_feedback_duration: 200,
	accuracy_threshold: 0.65, // for adaptive feedback
	rt_threshold: 1000, // for adaptive feedback
	estimated_trial_duration: 500, // ms (for estimating total experiment time)
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

/**
 * Shuffles a transition matrix by permuting states while preserving the probability distribution.
 * This reorders which position corresponds to which entropy level without changing the underlying
 * transition structure.
 *
 * @param {number[][]} matrix - Square transition matrix
 * @returns {number[][]} Shuffled transition matrix with same structure but reordered states
 */
function shuffleTransitionMatrix(matrix) {
	const n = matrix.length;

	// Generate random permutation of indices [0, 1, 2, ..., n-1]
	const permutation = Array.from({length: n}, (_, i) => i);
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[permutation[i], permutation[j]] = [permutation[j], permutation[i]];
	}

	// Create new matrix by permuting both rows and columns
	const shuffled = Array(n)
		.fill(null)
		.map(() => Array(n).fill(0));

	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			// Map position i to permutation[i] and position j to permutation[j]
			shuffled[i][j] = matrix[permutation[i]][permutation[j]];
		}
	}

	return shuffled;
}

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

function entropy(probs) {
	probs = Array.isArray(probs) ? probs : Array.from(probs);
	const p = probs.filter((x) => x > 0);
	return -p.reduce((sum, prob) => sum + prob * Math.log2(prob), 0);
}

function createStimulusDisplay(
	position = null,
	matrixSize,
	showKeys = false,
	feedbackMessage = "",
) {
	let html = '<div class="feedback-message">';
	if (feedbackMessage) {
		html += feedbackMessage;
	}
	html += "</div>";
	html += '<div class="stimulus-container">';
	for (let i = 0; i < matrixSize; i++) {
		const active = i === position ? "active" : "";
		html += `<div class="position-wrapper">`;
		if (showKeys) {
			html += `<div class="key-label">${KEY_MAPPINGS[matrixSize][i].toUpperCase()}</div>`;
		}
		html += `<div class="position-box ${active}" data-position="${i}"></div>`;
		html += "</div>";
	}
	html += "</div>";
	html += `<div class="finger-diagram-container">
			<img src="assets/finger-diagrams/finger-diagram-${matrixSize}pos.png" alt="Finger position guide" class="finger-diagram" />
		</div>`;

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

	// Randomly assign matrix size
	const matrixSizes = [4, 5, 6, 7, 8];
	const condition = await jsPsychPipe.getCondition(EXPERIMENT_CONFIG.datapipe_id); // 0-4
	EXPERIMENT_CONFIG.matrix_size = matrixSizes[condition]; // Update config with assigned matrix size

	// Load transition matrix and shuffle it
	const {data, shape} = await load(
		`./assets/transition-matrices/matrix_${EXPERIMENT_CONFIG.matrix_size}x${EXPERIMENT_CONFIG.matrix_size}.npy`,
	);
	console.log("Loaded matrix data:", data, "shape:", shape);

	// Convert flat array to 2D matrix
	const matrixSize = EXPERIMENT_CONFIG.matrix_size;
	const originalMatrix = [];
	for (let i = 0; i < matrixSize; i++) {
		originalMatrix.push(data.slice(i * matrixSize, (i + 1) * matrixSize));
	}
	console.log("Original matrix:", originalMatrix);
	EXPERIMENT_CONFIG.transition_matrix = shuffleTransitionMatrix(originalMatrix);
	EXPERIMENT_CONFIG.conditional_entropies = EXPERIMENT_CONFIG.transition_matrix.map((row) =>
		entropy(row),
	);
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

	console.log("Experiment initialized:", {
		matrixSize: EXPERIMENT_CONFIG.matrix_size,
		transitionMatrix: EXPERIMENT_CONFIG.transition_matrix,
		entropies: EXPERIMENT_CONFIG.conditional_entropies,
		sequence: EXPERIMENT_CONFIG.sequence,
		totalTrials: EXPERIMENT_CONFIG.total_trials,
	});
}

const jsPsych = initJsPsych();

let timeline = [];

// FULLSCREEN
const enter_fullscreen = {
	type: jsPsychFullscreen,
	fullscreen_mode: true,
	data: {
		phase: "fullscreen",
		experiment_trial_type: "fullscreen",
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
					<p>The set of keys you will use to respond are:<br>${keyElements}</p>
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
		experiment_trial_type: "instructions",
	},
};

// Practice trials
function createPracticeTrial(position, trialIndex) {
	const size = EXPERIMENT_CONFIG.matrix_size;
	const correctKey = KEY_MAPPINGS[size][position];
	let isRetry = false; // Track if this is a retry attempt

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
				data: function () {
					return {
						phase: "practice",
						experiment_trial_type: isRetry ? "retry" : "stimulus",
						trial_index: trialIndex,
						position: position,
						correct_key: correctKey,
					};
				},
				on_load: function () {
					setupKeyPressHandlers(size);
				},
				on_finish: function (data) {
					data.correct = data.response === correctKey;
					if (!data.correct) {
						isRetry = true; // Mark next attempt as retry
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
					phase: "practice",
					experiment_trial_type: "feedback",
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
			phase: "practice",
			experiment_trial_type: "rsi",
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
	let isRetry = false; // Track if this is a retry attempt

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
				data: function () {
					return {
						phase: "main",
						experiment_trial_type: isRetry ? "retry" : "stimulus",
						block: blockNum,
						trial_in_block: trialInBlock,
						overall_trial: overallTrial,
						position: position,
						correct_key: correctKey,
						matrix_size: size,
					};
				},
				on_load: function () {
					setupKeyPressHandlers(size);
				},
				on_finish: function (data) {
					data.correct = data.response === correctKey;
					if (!data.correct) {
						isRetry = true; // Mark next attempt as retry
					}

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
					phase: "main",
					experiment_trial_type: "feedback",
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
			phase: "main",
			experiment_trial_type: "rsi",
		},
	};

	return {
		timeline: [correctionLoop, rsi],
	};
}

// Block break with feedback
function createBlockBreak(blockNum) {
	return {
		type: jsPsychHtmlKeyboardResponse,
		stimulus: function () {
			// Calculate block statistics - only use main_stimulus trials
			const allData = jsPsych.data
				.get()
				.filter({phase: "main", experiment_trial_type: "stimulus", block: blockNum - 1});
			const blockTrials = allData.values();
			const correctCount = blockTrials.filter((t) => t.correct).length;
			const totalCount = blockTrials.length;
			const accuracy = (correctCount / totalCount) * 100;
			const meanRT = (
				blockTrials.filter((t) => t.correct).reduce((sum, t) => sum + t.rt, 0) /
				blockTrials.filter((t) => t.correct).length
			).toFixed(0);

			// Adaptive feedback
			let feedback = "";
			if (accuracy < EXPERIMENT_CONFIG.accuracy_threshold * 100) {
				feedback = '<p style="color: #f44336;"><strong>Try to be more accurate.</strong></p>';
			} else if (meanRT > EXPERIMENT_CONFIG.rt_threshold) {
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
                        <p>You got ${blockTrials.filter((t) => t.correct).length} out of ${blockTrials.length} trials correct.</p>

                        ${feedback}

                        <p style="margin-top: 30px;">Feel free to take a break.</p>
                        <p style="font-size: 14px; color: #666;">Press any key to continue.</p>
                    </div>
                `;
		},
		choices: "ALL_KEYS",
		data: {
			phase: "main",
			experiment_trial_type: "block_break",
		},
	};
}

// Final feedback after last block
function createFinalFeedback() {
	return {
		type: jsPsychHtmlKeyboardResponse,
		stimulus: function () {
			// Calculate final block statistics - only use main_stimulus trials
			const finalBlock = EXPERIMENT_CONFIG.n_blocks - 1;
			const allData = jsPsych.data
				.get()
				.filter({phase: "main", experiment_trial_type: "stimulus", block: finalBlock});
			const blockTrials = allData.values();
			const correctCount = blockTrials.filter((t) => t.correct).length;
			const totalCount = blockTrials.length;
			return `
                    <div class="block-feedback">
                        <h2>All Blocks Complete!</h2>

                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: 100%"></div>
                        </div>

                        <p><strong>Final Block:</strong></p>
                        <p>You got ${correctCount} out of ${totalCount} trials correct.</p>

                        <p style="margin-top: 30px;">Thank you for completing all the trials!</p>
                        <p style="font-size: 14px; color: #666;">Press any key to proceed to a few final questions.</p>
                    </div>
                `;
		},
		choices: "ALL_KEYS",
		data: {
			phase: "main",
			experiment_trial_type: "final_feedback",
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
		experiment_trial_type: "questionnaire",
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
				experiment_trial_type: "questionnaire",
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
		experiment_trial_type: "questionnaire",
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
				experiment_trial_type: "questionnaire",
				questionnaire_item: "q2b_describe_regularity",
			},
		},
	],
	conditional_function: function () {
		const lastResponse = jsPsych.data.get().last(1).values()[0];
		return lastResponse.response.q2_noticed_regularity === "Yes";
	},
};

// Q2c: Confidence
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
				experiment_trial_type: "questionnaire",
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
		experiment_trial_type: "questionnaire",
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
				experiment_trial_type: "questionnaire",
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
		experiment_trial_type: "questionnaire",
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
		experiment_trial_type: "questionnaire",
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
		experiment_trial_type: "questionnaire",
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
		experiment_trial_type: "debrief",
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
		experiment_trial_type: "save_data",
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
		conditional_entropies: JSON.stringify(EXPERIMENT_CONFIG.conditional_entropies),
		sequence: JSON.stringify(EXPERIMENT_CONFIG.sequence),
		trials_per_block: EXPERIMENT_CONFIG.trials_per_block,
		total_trials: EXPERIMENT_CONFIG.total_trials,
		practice_trials: EXPERIMENT_CONFIG.practice_trials,
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
			experiment_trial_type: "preload",
		},
	};

	// Add components to timeline
	timeline.push(preload);
	timeline.push(enter_fullscreen);
	timeline.push(instructions);

	// Practice block - sample without replacement, ensuring all positions are practiced
	let practiceSequence = [];
	const nPositions = EXPERIMENT_CONFIG.matrix_size;
	const nPracticeTrials = EXPERIMENT_CONFIG.practice_trials;

	// Sample without replacement - cycle through all positions, reset when exhausted
	while (practiceSequence.length < nPracticeTrials) {
		// Create array with all positions
		let positions = [];
		for (let pos = 0; pos < nPositions; pos++) {
			positions.push(pos);
		}
		// Shuffle and add to sequence
		positions = jsPsych.randomization.shuffle(positions);
		practiceSequence.push(...positions);
	}

	// Trim to exact number of practice trials
	practiceSequence = practiceSequence.slice(0, nPracticeTrials);

	for (let i = 0; i < EXPERIMENT_CONFIG.practice_trials; i++) {
		timeline.push(createPracticeTrial(practiceSequence[i], i));
	}

	// Practice feedback
	timeline.push({
		type: jsPsychHtmlButtonResponse,
		stimulus: function () {
			const practiceData = jsPsych.data
				.get()
				.filter({phase: "practice", experiment_trial_type: "stimulus"});
			const correctCount = practiceData.filter({correct: true}).count();
			const totalCount = practiceData.count();

			return `
                <div class="instruction-text">
                    <h2>Practice Complete!</h2>
                    <p>You got ${correctCount} out of ${totalCount} trials correct.</p>
                    <p>Remember: Respond as quickly and accurately as possible.</p>
					<p>Now, you will complete ${EXPERIMENT_CONFIG.n_blocks} blocks of ${EXPERIMENT_CONFIG.trials_per_block} trials.</p>
                    <p>Between blocks, you will get a break to rest.</p>
                    <p>The entire task takes about ${Math.ceil(((EXPERIMENT_CONFIG.n_blocks * EXPERIMENT_CONFIG.trials_per_block * (EXPERIMENT_CONFIG.estimated_trial_duration + EXPERIMENT_CONFIG.correct_feedback_duration + EXPERIMENT_CONFIG.rsi) + EXPERIMENT_CONFIG.n_blocks * 15000) * 1.2) / 60000)} minutes.</p>
                    <p><strong>The main task will now begin.</strong></p>
                </div>
            `;
		},
		choices: ["Start Main Task"],
		data: {
			phase: "practice",
			experiment_trial_type: "practice_end",
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
