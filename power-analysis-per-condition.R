# ==============================================================================
# POWER ANALYSIS (PER CONDITION)
# ==============================================================================
#
# Based on pilot data (N=11, ~2 per matrix size).
# Models are fit separately per condition (matrix_size) so that power is
# computed for each condition independently. The hardest condition
# (smallest effect size = largest matrix size) drives the final N
# recommendation, ensuring adequate power across all conditions.
#
# N values throughout refer to N PER CONDITION, not total N.
#
# ==============================================================================

library(tidyverse)
library(lme4)
library(lmerTest)
library(simr)
library(here)

filter <- dplyr::filter

# ==============================================================================
# 1. FIT PILOT MODELS PER CONDITION
# ==============================================================================

fit_models_per_condition <- function(data) {

  cat("\n", strrep("=", 70), "\n")
  cat("FITTING MODELS PER CONDITION\n")
  cat(strrep("=", 70), "\n\n")

  data_correct <- data %>% filter(correct)

  cat(sprintf(
    "Overall: %d correct / %d total trials (%.1f%% accuracy)\n\n",
    nrow(data_correct), nrow(data),
    100 * nrow(data_correct) / nrow(data)
  ))

  conditions <- sort(unique(data_correct$matrix_size))
  models_by_condition <- list()

  for (cond in conditions) {
    cat(sprintf("--- Condition: matrix_size = %d ---\n", cond))
    d <- data_correct %>% filter(matrix_size == cond)
    cat(sprintf("  N subjects: %d, N trials: %d\n",
                n_distinct(d$subject_id), nrow(d)))

    # Learning model: RT ~ block
    m_learning <- tryCatch(
      lmer(rt ~ block + (block | subject_id),
           data = d, REML = FALSE,
           control = lmerControl(optimizer = "bobyqa")),
      error = function(e) {
        cat("  m_learning failed:", conditionMessage(e), "\n")
        NULL
      }
    )

    # Entropy model: RT ~ conditional_entropy + block
    m_entropy <- tryCatch(
      lmer(rt ~ conditional_entropy + block + (1 | subject_id),
           data = d, REML = FALSE,
           control = lmerControl(optimizer = "bobyqa")),
      error = function(e) {
        cat("  m_entropy failed:", conditionMessage(e), "\n")
        NULL
      }
    )

    if (!is.null(m_learning))
      cat(sprintf("  β_block               = %.4f\n", fixef(m_learning)["block"]))
    if (!is.null(m_entropy))
      cat(sprintf("  β_conditional_entropy = %.4f\n",
                  fixef(m_entropy)["conditional_entropy"]))
    cat("\n")

    models_by_condition[[as.character(cond)]] <- list(
      m_learning = m_learning,
      m_entropy  = m_entropy,
      n_subjects = n_distinct(d$subject_id),
      n_trials   = nrow(d)
    )
  }

  models_by_condition
}

# ==============================================================================
# 2. POWER SIMULATION PER CONDITION
# ==============================================================================
# Returns a data frame with one row per (condition x target_n).
# effect:      fixed effect name as it appears in the model (e.g. "block")
# model_slot:  "m_learning" or "m_entropy"

power_per_condition <- function(models_by_condition,
                                effect,
                                model_slot,
                                target_n = c(20, 40, 60, 80, 100),
                                nsim = 100) {

  cat("\n", strrep("=", 70), "\n")
  cat(sprintf("POWER ANALYSIS: %s\n", toupper(effect)))
  cat(strrep("=", 70), "\n\n")

  results <- map_dfr(names(models_by_condition), function(cond) {
    m <- models_by_condition[[cond]][[model_slot]]
    if (is.null(m)) {
      cat(sprintf("  Skipping condition %s (model failed to fit)\n\n", cond))
      return(NULL)
    }

    beta <- fixef(m)[effect]
    cat(sprintf("Condition %s  |  β_%s = %.4f\n", cond, effect, beta))

    map_dfr(target_n, function(n) {
      cat(sprintf("  N = %3d per condition ... ", n))
      sim <- tryCatch(
        powerSim(extend(m, along = "subject_id", n = n),
                 nsim = nsim,
                 test = fixed(effect, "z"),
                 progress = FALSE,
                 seed = 42),
        error = function(e) { cat("FAILED\n"); NULL }
      )
      if (is.null(sim)) return(NULL)
      s <- summary(sim)
      cat(sprintf("power = %.3f [%.3f, %.3f]\n", s$mean, s$lower, s$upper))
      data.frame(
        condition       = as.integer(cond),
        n_per_condition = n,
        power           = s$mean,
        ci_lower        = s$lower,
        ci_upper        = s$upper,
        beta            = beta
      )
    })
  })

  # Report hardest condition
  hardest <- results %>%
    group_by(condition) %>%
    summarise(beta = first(beta), .groups = "drop") %>%
    slice_min(abs(beta), n = 1)
  cat(sprintf(
    "\nHardest condition: matrix_size = %d (β_%s = %.4f)\n\n",
    hardest$condition, effect, hardest$beta
  ))

  results
}

# ==============================================================================
# 3. PLOT: ONE POWER CURVE PER CONDITION
# ==============================================================================

plot_power_curves <- function(power_df, effect_label = "Effect") {
  power_df %>%
    mutate(condition = factor(condition)) %>%
    ggplot(aes(x = n_per_condition, y = power,
               color = condition, fill = condition, group = condition)) +
    geom_ribbon(aes(ymin = ci_lower, ymax = ci_upper),
                alpha = 0.15, color = NA) +
    geom_line(linewidth = 1) +
    geom_point(size = 2) +
    geom_hline(yintercept = 0.80, linetype = "dashed", color = "black") +
    annotate("text", x = max(power_df$n_per_condition),
             y = 0.82, label = "80%", hjust = 1.1, size = 3.5) +
    scale_y_continuous(limits = c(0, 1), breaks = seq(0, 1, 0.2),
                       labels = scales::percent) +
    labs(
      title   = paste0("Power Curve: ", effect_label),
      x       = "N per condition",
      y       = "Statistical Power",
      color   = "Matrix size",
      fill    = "Matrix size",
      caption = "Shaded bands = 95% CI. X-axis is N per condition, not total N."
    ) +
    theme_minimal(base_size = 13) +
    theme(plot.title = element_text(face = "bold"))
}

# ==============================================================================
# 4. COMPLETE PIPELINE
# ==============================================================================

run_complete_power_analysis <- function(pilot_df,
                                        target_n  = c(20, 40, 60, 80, 100),
                                        nsim      = 100,
                                        save_plots = TRUE) {

  cat("\n", strrep("#", 78), "\n")
  cat("#           COMPLETE POWER ANALYSIS — PER CONDITION                         #\n")
  cat(strrep("#", 78), "\n\n")

  models <- fit_models_per_condition(pilot_df)

  power_learning <- power_per_condition(
    models, effect = "block", model_slot = "m_learning",
    target_n = target_n, nsim = nsim
  )

  power_entropy <- power_per_condition(
    models, effect = "conditional_entropy", model_slot = "m_entropy",
    target_n = target_n, nsim = nsim
  )

  if (save_plots) {
    dir.create(here("plots"), showWarnings = FALSE)
    ggsave(here("plots", "power_curve_learning.png"),
           plot_power_curves(power_learning, "Learning Effect (β_block)"),
           width = 10, height = 6, dpi = 300)
    ggsave(here("plots", "power_curve_entropy.png"),
           plot_power_curves(power_entropy,
                             "Entropy Effect (β_conditional_entropy)"),
           width = 10, height = 6, dpi = 300)
    cat("Saved power curve plots to plots/\n")
  }

  # Summary table for hardest condition only
  get_hardest_summary <- function(power_df, label) {
    hardest_cond <- power_df %>%
      group_by(condition) %>%
      summarise(beta = first(beta), .groups = "drop") %>%
      slice_min(abs(beta), n = 1) %>%
      pull(condition)
    power_df %>%
      filter(condition == hardest_cond) %>%
      select(n_per_condition, power, ci_lower, ci_upper) %>%
      rename_with(~ paste0(label, "_", .), c(power, ci_lower, ci_upper))
  }

  summary_df <- full_join(
    get_hardest_summary(power_learning, "learning"),
    get_hardest_summary(power_entropy,  "entropy"),
    by = "n_per_condition"
  )

  cat("\n", strrep("=", 70), "\n")
  cat("SUMMARY: HARDEST CONDITION (smallest effect size per effect)\n")
  cat(strrep("=", 70), "\n\n")
  print(summary_df)

  # Recommendation
  n_learn_80   <- summary_df %>% filter(learning_power >= 0.80) %>%
    pull(n_per_condition) %>% min(na.rm = TRUE)
  n_entropy_80 <- summary_df %>% filter(entropy_power  >= 0.80) %>%
    pull(n_per_condition) %>% min(na.rm = TRUE)

  cat("\n", strrep("=", 70), "\n")
  cat("RECOMMENDATION\n")
  cat(strrep("=", 70), "\n\n")

  if (is.finite(n_learn_80) && is.finite(n_entropy_80)) {
    n_rec  <- max(n_learn_80, n_entropy_80)
    total  <- n_rec * 5
    cat(sprintf("N per condition for 80%% power on both effects: %d\n", n_rec))
    cat(sprintf("Total N across all 5 conditions:               %d\n", total))
  } else {
    cat("Target power not reached within tested N range.\n")
    cat("Increase target_n or collect more pilot data.\n")
  }
  cat("\n")

  invisible(list(
    models         = models,
    power_learning = power_learning,
    power_entropy  = power_entropy,
    summary        = summary_df
  ))
}

# ==============================================================================
# LOAD DATA & RUN
# ==============================================================================

df <- list.files(here("data/pilot-data/"), pattern = "*.csv",
                 full.names = TRUE) %>%
  lapply(read.csv) %>%
  bind_rows() %>%
  mutate(
    correct           = as.logical(tolower(correct)),
    rt                = as.numeric(rt)
  ) %>%
  filter(phase == "main", experiment_trial_type == "stimulus",
         !is.na(rt), rt > 0)

power_analysis_results <- run_complete_power_analysis(
  pilot_df   = df,
  target_n   = c(20, 40, 60, 80, 100),
  nsim       = 100,
  save_plots = TRUE
)
