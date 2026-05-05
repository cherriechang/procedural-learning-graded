#!/usr/bin/env python3

import numpy as np

def generate_tikz_graph(matrix_file, output_file, n_positions):
    """Generate TikZ graph for a transition matrix."""
    positions = [str(i) for i in range(1, n_positions + 1)]
    transition_matrix = np.load(matrix_file)
    
    n = len(positions)
    
    # Generate LaTeX/TikZ code
    latex_code = r"""\documentclass[border=5mm]{standalone}
\usepackage{tikz}
\usetikzlibrary{arrows.meta,positioning,calc}
\usepackage{times}

\begin{document}
\begin{tikzpicture}[
    node distance=3cm,
    state/.style={circle, draw=black, thick, minimum size=1.2cm, fill=yellow!20, font=\Large\bfseries\fontfamily{ptm}\selectfont},
    every edge/.style={draw, thick, -Stealth},
    edge label/.style={font=\small\fontfamily{ptm}\selectfont, black, fill=white, inner sep=1pt}
]

"""
    
    # Calculate positions on a circle
    radius = 4
    angle_step = 360 / n
    
    # Place nodes in a circle
    for i, pos_name in enumerate(positions):
        angle = 90 - i * angle_step  # Start at top (90 degrees) and go clockwise
        latex_code += f"\\node[state] ({pos_name}) at ({angle}:{radius}cm) {{{pos_name}}};\n"
    
    latex_code += "\n"
    
    # Draw edges
    for i, from_state in enumerate(positions):
        for j, to_state in enumerate(positions):
            prob = transition_matrix[i, j]
            if prob > 0:
                # Scale opacity: 0.2 to 1.0
                min_alpha, max_alpha = 0.2, 1.0
                alpha = min_alpha + (prob * (max_alpha - min_alpha))
                
                label = f".{int(prob * 100):02d}"
                
                if i == j:  # Self-loop
                    latex_code += f"\\path ({from_state}) edge[loop, out=70, in=110, looseness=8, opacity={alpha:.2f}] node[edge label, above] {{{label}}} ({to_state});\n"
                else:
                    # Regular edge with bend
                    latex_code += f"\\path ({from_state}) edge[bend right=10, opacity={alpha:.2f}] node[edge label, midway, fill=white, inner sep=2pt] {{{label}}} ({to_state});\n"
    
    latex_code += r"""
\end{tikzpicture}
\end{document}
"""
    
    # Save to file
    with open(output_file, 'w') as f:
        f.write(latex_code)
    
    print(f"LaTeX code saved to {output_file}")
    return output_file

if __name__ == "__main__":
    # Generate graph for 4x4 matrix
    print("Generating 4x4 transition graph...")
    tex_file_4x4 = generate_tikz_graph("./matrix_4x4.npy", "transition-graph-4x4.tex", 4)
    
    # Generate graph for 8x8 matrix
    print("Generating 8x8 transition graph...")
    tex_file_8x8 = generate_tikz_graph("./matrix_8x8.npy", "transition-graph-8x8.tex", 8)
    
    print("\nCompile with:")
    print(f"  pdflatex {tex_file_4x4}")
    print(f"  pdflatex {tex_file_8x8}")
