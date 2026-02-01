# ==============================================================================
# POWER ANALYSIS
# ==============================================================================
#
# Based on pilot data (N=11, ~2 per matrix size)
# (3 for 7x7 because my sister did it late)
# Uses simulation-based approach
#
# RQs:
# 1. Does learning occur? (RT ~ block)
# 2. Does entropy predict RT? (RT ~ entropy)  
# 3. Does entropy sensitivity change with learning? (RT ~ entropy × block)
# 4. Does matrix size moderate effects? (RT ~ entropy × matrix_size)
#
# ==============================================================================

library(tidyverse)
library(lme4)
library(lmerTest)
library(simr)      # For power simulations
library(parallel)  # For faster computation

# ==============================================================================
# 1. FIT PILOT MODELS
# ==============================================================================

fit_pilot_models <- function(data) {
  
  cat("\n" ,strrep("=", 70), "\n")
  cat("FITTING MODELS TO PILOT DATA\n")
  cat("\n",strrep("=", 70), "\n\n")
  
  # Filter to correct trials only
  data_correct <- data %>% filter(correct)
  
  cat(sprintf("Using %d correct trials (%.1f%% accuracy)\n\n",
              nrow(data_correct), 
              100 * nrow(data_correct) / nrow(data)))
  
  # Model 1: Learning effect
  cat("Model 1: Learning (RT ~ block)\n")
  m1 <- lmer(rt ~ block + (block | subject_id),
             data = data_correct,
             REML = FALSE,
             control = lmerControl(optimizer = "bobyqa")) 
  
  cat("  Converged:", !any(grepl("failed to converge", m1@optinfo$conv$lme4$messages)), "\n")
  beta_block <- fixef(m1)['block']
  cat(sprintf("  β_block = %.2f ms/block\n", beta_block))
  
  # Model 2: Entropy effect
  cat("\nModel 2: Entropy (RT ~ entropy)\n")
  m2 <- lmer(rt ~ entropy + (block | subject_id) + (1 | position),
             data = df.correct,
             REML = FALSE,
             control = lmerControl(optimizer = "bobyqa"))
  
  cat("  Converged:", !any(grepl("failed to converge", m2@optinfo$conv$lme4$messages)), "\n")
  beta_entropy <- fixef(m2)['entropy']
  cat(sprintf("  β_entropy = %.2f ms/bit\n", beta_entropy))
  
  # Model 3: Combined
  cat("\nModel 3: Combined (RT ~ entropy + block)\n")
  m3 <- lmer(rt ~ entropy + block + (block | subject_id),
             data = data_correct,
             REML = FALSE,
             control = lmerControl(optimizer = "bobyqa"))
  
  cat("  Converged:", !any(grepl("failed to converge", m3@optinfo$conv$lme4$messages)), "\n")
  cat(sprintf("  β_entropy = %.2f ms/bit\n", fixef(m3)['entropy']))
  cat(sprintf("  β_block = %.2f ms/block\n", fixef(m3)['block']))
  
  
  # Model 4: Interaction
  cat("\nModel 4: Interaction (RT ~ entropy × block)\n")
  m4 <- tryCatch({
    lmer(rt ~ entropy * block + (1 | subject_id) + (1 | position),
         data = df.correct,
         REML = FALSE,
         control = lmerControl(optimizer = "bobyqa"),
         verbose = TRUE)
  }, error = function(e) {
    cat("  Model did not converge (expected with small pilot)\n")
    return(NULL)
  })
  
  if (!is.null(m4)) {
    cat("  Converged:", !any(grepl("failed to converge", m4@optinfo$conv$lme4$messages)), "\n")
    cat(sprintf("  β_entropy:block = %.3f\n", fixef(m4)['entropy:block']))
  }
  
  return(list(
    m1_learning = m1,
    m2_entropy = m2,
    m3_combined = m3,
    m4_interaction = m4,
    data_correct = data_correct
  ))
}

# ==============================================================================
# 2. POWER ANALYSIS: LEARNING EFFECT
# ==============================================================================

power_analysis_learning <- function(pilot_model, target_n = c(20, 40, 60, 80, 100)) {
  
  cat("\n" ,strrep("=", 70), "\n")
  cat("POWER ANALYSIS: LEARNING EFFECT (β_block)\n")
  cat(strrep("=", 70), "\n\n")
  
  # Current effect size
  beta_block <- fixef(pilot_model)['block']
  cat(sprintf("Pilot effect size: β_block = %.2f ms/block\n", beta_block))
  
  # Extract current N
  current_n <- length(unique(pilot_model@frame$subject_id))
  cat(sprintf("Current N: %d subject_ids\n\n", current_n))
  
  results <- list()
  
  for (n in target_n) {
    cat(sprintf("Simulating N = %d subject_ids...\n", n))
    
    # Extend model to target N
    extended_model <- extend(pilot_model, along = "subject_id", n = n)
    
    # Run power simulation
    # Use fewer sims for speed (100 is reasonable, 1000 is gold standard)
    power_sim <- powerSim(extended_model, 
                          nsim = 100,
                          test = fixed("block", "z"),
                          progress = FALSE,
                          seed = 12345)
    
    power_value <- summary(power_sim)$mean
    ci_lower <- summary(power_sim)$lower
    ci_upper <- summary(power_sim)$upper
    
    cat(sprintf("  Power = %.3f [%.3f, %.3f]\n", 
                power_value, ci_lower, ci_upper))
    
    results[[paste0("n", n)]] <- list(
      n = n,
      power = power_value,
      ci_lower = ci_lower,
      ci_upper = ci_upper,
      sim = power_sim
    )
  }
  
  cat("\n")
  
  # Find N for 80% power
  power_values <- sapply(results, function(x) x$power)
  n_values <- sapply(results, function(x) x$n)
  
  if (any(power_values >= 0.80)) {
    n_80 <- min(n_values[power_values >= 0.80])
    cat(sprintf("✓ N = %d needed for 80%% power\n", n_80))
  } else {
    cat("⚠ None of the tested N values reach 80% power\n")
    cat("  Try larger N or effect may be too small to detect\n")
  }
  
  return(results)
}

# ==============================================================================
# 3. POWER ANALYSIS: ENTROPY EFFECT
# ==============================================================================

power_analysis_entropy <- function(pilot_model, target_n = c(20, 40, 60, 80, 100)) {
  
  cat("\n" ,strrep("=", 70), "\n")
  cat("POWER ANALYSIS: ENTROPY EFFECT (β_entropy)\n")
  cat(strrep("=", 70), "\n\n")
  
  # Current effect size
  beta_entropy <- fixef(pilot_model)['entropy']
  cat(sprintf("Pilot effect size: β_entropy = %.2f ms/bit\n", beta_entropy))
  
  # Extract current N
  current_n <- length(unique(pilot_model@frame$subject_id))
  cat(sprintf("Current N: %d subject_ids\n\n", current_n))
  
  results <- list()
  
  for (n in target_n) {
    cat(sprintf("Simulating N = %d subject_ids...\n", n))
    
    # Extend model to target N
    extended_model <- extend(pilot_model, along = "subject_id", n = n)
    
    # Run power simulation
    power_sim <- powerSim(extended_model,
                          nsim = 100,
                          test = fixed("entropy", "z"),
                          progress = FALSE,
                          seed = 12345)
    
    power_value <- summary(power_sim)$mean
    ci_lower <- summary(power_sim)$lower
    ci_upper <- summary(power_sim)$upper
    
    cat(sprintf("  Power = %.3f [%.3f, %.3f]\n",
                power_value, ci_lower, ci_upper))
    
    results[[paste0("n", n)]] <- list(
      n = n,
      power = power_value,
      ci_lower = ci_lower,
      ci_upper = ci_upper,
      sim = power_sim
    )
  }
  
  cat("\n")
  
  # Find N for 80% power
  power_values <- sapply(results, function(x) x$power)
  n_values <- sapply(results, function(x) x$n)
  
  if (any(power_values >= 0.80)) {
    n_80 <- min(n_values[power_values >= 0.80])
    cat(sprintf("✓ N = %d needed for 80%% power\n", n_80))
  } else {
    cat("⚠ None of the tested N values reach 80% power\n")
    cat("  Try larger N or effect may be too small to detect\n")
  }
  
  return(results)
}

# ==============================================================================
# 4. POWER CURVE (VISUAL)
# ==============================================================================

plot_power_curve <- function(power_results, effect_name = "Effect") {
  
  # Extract data
  df <- data.frame(
    n = sapply(power_results, function(x) x$n),
    power = sapply(power_results, function(x) x$power),
    ci_lower = sapply(power_results, function(x) x$ci_lower),
    ci_upper = sapply(power_results, function(x) x$ci_upper)
  )
  
  # Create plot
  p <- ggplot(df, aes(x = n, y = power)) +
    geom_line(size = 1.5, color = "steelblue") +
    geom_point(size = 3, color = "steelblue") +
    geom_errorbar(aes(ymin = ci_lower, ymax = ci_upper),
                  width = 2, color = "steelblue", alpha = 0.5) +
    geom_hline(yintercept = 0.80, linetype = "dashed",
               color = "red", size = 1) +
    annotate("text", x = max(df$n) * 0.9, y = 0.82,
             label = "80% power threshold", color = "red") +
    scale_y_continuous(limits = c(0, 1),
                       breaks = seq(0, 1, 0.2),
                       labels = scales::percent) +
    labs(
      title = paste0("Power Curve: ", effect_name),
      x = "Sample Size (N subject_ids)",
      y = "Statistical Power",
      caption = "Error bars show 95% confidence intervals"
    ) +
    theme_minimal(base_size = 14) +
    theme(
      plot.title = element_text(face = "bold", size = 16),
      axis.title = element_text(face = "bold")
    )
  
  return(p)
}

# ==============================================================================
# 5. EFFECT SIZE MANIPULATION (SENSITIVITY ANALYSIS)
# ==============================================================================

power_analysis_sensitivity <- function(pilot_model, 
                                       effect_name = "entropy",
                                       multipliers = c(0.5, 0.75, 1.0, 1.25, 1.5),
                                       target_n = 60) {
  
  cat("\n" ,strrep("=", 70), "\n")
  cat("SENSITIVITY ANALYSIS: Effect of Effect Size\n")
  cat(strrep("=", 70), "\n\n")
  
  cat(sprintf("Testing different effect sizes at N = %d\n\n", target_n))
  
  # Get original effect size
  original_beta <- fixef(pilot_model)[effect_name]
  
  results <- list()
  
  for (mult in multipliers) {
    new_beta <- original_beta * mult
    
    cat(sprintf("Effect size: %.2f × original (β = %.2f)\n", mult, new_beta))
    
    # Modify effect size
    modified_model <- pilot_model
    fixef(modified_model)[effect_name] <- new_beta
    
    # Extend to target N
    extended_model <- extend(modified_model, along = "subject_id", n = target_n)
    
    # Power simulation
    power_sim <- powerSim(extended_model,
                          nsim = 100,
                          test = fixed(effect_name, "z"),
                          progress = FALSE,
                          seed = 12345)
    
    power_value <- summary(power_sim)$mean
    
    cat(sprintf("  Power = %.3f\n\n", power_value))
    
    results[[paste0("mult_", mult)]] <- list(
      multiplier = mult,
      beta = new_beta,
      power = power_value
    )
  }
  
  return(results)
}

# ==============================================================================
# 6. COMPLETE POWER ANALYSIS PIPELINE
# ==============================================================================

run_complete_power_analysis <- function(pilot_df,
                                        target_n = c(20, 40, 60, 80, 100, 150, 200),
                                        save_plots = TRUE) {
  
  cat("\n")
  cat("################################################################################\n")
  cat("#                                                                              #\n")
  cat("#              COMPLETE POWER ANALYSIS FOR PILOT DATA                         #\n")
  cat("#                                                                              #\n")
  cat("################################################################################\n\n")
  
  # Load data
  data <- pilot_df
  
  # Fit models
  models <- fit_pilot_models(data)
  
  # Power analysis for learning effect
  power_learning <- power_analysis_learning(models$m1_learning, target_n)
  
  # Power analysis for entropy effect  
  power_entropy <- power_analysis_entropy(models$m3_combined, target_n)
  
  # Create power curves
  if (save_plots) {
    cat("\n" ,strrep("=", 70), "\n")
    cat("GENERATING POWER CURVES\n")
    cat(strrep("=", 70), "\n\n")
    
    p1 <- plot_power_curve(power_learning, "Learning Effect (β_block)")
    ggsave("power_curve_learning.png", p1, width = 10, height = 6, dpi = 300)
    cat("  Saved: power_curve_learning.png\n")
    
    p2 <- plot_power_curve(power_entropy, "Entropy Effect (β_entropy)")
    ggsave("power_curve_entropy.png", p2, width = 10, height = 6, dpi = 300)
    cat("  Saved: power_curve_entropy.png\n")
  }
  
  # Summary table
  cat("\n" ,strrep("=", 70), "\n")
  cat("POWER ANALYSIS SUMMARY\n")
  cat(strrep("=", 70), "\n\n")
  
  summary_df <- data.frame(
    N = target_n,
    Power_Learning = sapply(power_learning, function(x) x$power),
    Power_Entropy = sapply(power_entropy, function(x) x$power)
  )
  
  print(summary_df)
  
  cat("\n")
  
  # Recommendations
  cat(strrep("=", 70), "\n")
  cat("RECOMMENDATIONS\n")
  cat(strrep("=", 70), "\n\n")
  
  power_learn_80 <- min(summary_df$N[summary_df$Power_Learning >= 0.80], na.rm = TRUE)
  power_entropy_80 <- min(summary_df$N[summary_df$Power_Entropy >= 0.80], na.rm = TRUE)
  
  if (is.finite(power_learn_80) && is.finite(power_entropy_80)) {
    n_recommended <- max(power_learn_80, power_entropy_80)
    cat(sprintf("For 80%% power on BOTH effects: N ≥ %d subject_ids\n\n", n_recommended))
    
    # Calculate per matrix size
    n_per_size <- ceiling(n_recommended / 5)  # 5 matrix sizes
    cat(sprintf("With balanced design: ~%d subject_ids per matrix size (4, 5, 6, 7, 8)\n", 
                n_per_size))
    
    # Budget estimate (assuming $2/subject_id on Prolific)
    cost <- n_recommended * 2
    cat(sprintf("\nEstimated cost (Prolific @ $2/subject_id): $%d\n", cost))
    
  } else {
    cat("⚠ WARNING: Effects may be too small to detect with reasonable N\n")
    cat("  Consider:\n")
    cat("    - Larger pilot to get better effect size estimates\n")
    cat("    - Different design to increase effect sizes\n")
    cat("    - Focus on descriptive rather than inferential goals\n")
  }
  
  cat("\n")
  
  return(list(
    data = data,
    models = models,
    power_learning = power_learning,
    power_entropy = power_entropy,
    summary = summary_df
  ))
}

# ==============================================================================
# EXAMPLE USAGE
# ==============================================================================

# Run complete analysis
# results <- run_complete_power_analysis(
#   pilot_df = df
#   target_n = c(20, 40, 60, 80, 100, 150, 200),
#   save_plots = TRUE
# )

# ==============================================================================
# QUICK FUNCTIONS FOR SPECIFIC QUESTIONS
# ==============================================================================

# How much power do I have RIGHT NOW with pilot?
check_current_power <- function(pilot_model, effect_name = "entropy") {
  current_n <- length(unique(pilot_model@frame$subject_id))
  cat(sprintf("Current N = %d\n", current_n))
  
  power_sim <- powerSim(pilot_model,
                        nsim = 100,
                        test = fixed(effect_name, "z"),
                        progress = FALSE)
  
  cat(sprintf("Current power = %.3f\n", summary(power_sim)$mean))
}

# What N do I need for X% power?
find_required_n <- function(pilot_model, 
                            effect_name = "entropy",
                            target_power = 0.80,
                            max_n = 300) {
  
  pc <- powerCurve(pilot_model,
                   test = fixed(effect_name, "z"),
                   along = "subject_id",
                   breaks = seq(10, max_n, by = 10),
                   nsim = 50,  # Reduce for speed
                   progress = FALSE)
  
  plot(pc)
  
  # Find crossing point
  powers <- summary(pc)$mean
  ns <- summary(pc)$nlevels
  
  if (any(powers >= target_power)) {
    n_needed <- min(ns[powers >= target_power])
    cat(sprintf("\nN = %d needed for %.0f%% power\n", n_needed, target_power * 100))
  } else {
    cat(sprintf("\nTarget power of %.0f%% not reached within N = %d\n",
                target_power * 100, max_n))
  }
  
  return(pc)
}

power_analysis_results <- run_complete_power_analysis(pilot_df=df)
