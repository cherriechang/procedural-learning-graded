#!/usr/bin/env python3

import networkx as nx
import numpy as np
import matplotlib.pyplot as plt

# Set Times New Roman font globally
plt.rcParams['font.family'] = 'Times New Roman'

if __name__ == "__main__":
    # 4x4
    positions = ["1", "2", "3", "4", "5", "6", "7", "8",]

    transition_4x4 = np.load("./matrix_8x8.npy")

    transitions = {
        positions[i]: {positions[j]: transition_4x4[i, j] for j in range(len(positions))}
        for i in range(len(positions))
    }

    G = nx.DiGraph()

    # Add edges with probability as weight and label (format: .28 instead of 0.28)
    for from_state, to_states in transitions.items():
        for to_state, prob in to_states.items():
            if prob > 0.009:
                label = f"{prob:.2f}".lstrip('0') if prob < 1 else "1.0"
                G.add_edge(from_state, to_state, weight=prob, label=label)
    
    # Layout
    pos = nx.circular_layout(G)  # circular layout makes self-loops more visible
    
    # Draw nodes
    nx.draw_networkx_nodes(G, pos, node_size=2000, node_color="lightyellow", edgecolors="black", linewidths=2)
    nx.draw_networkx_labels(G, pos, font_size=16, font_weight="bold", font_family='Times New Roman')
    
    # Separate self-loops from regular edges
    self_loops = [(u, v) for u, v in G.edges() if u == v]
    regular_edges = [(u, v) for u, v in G.edges() if u != v]
    
    # Scale alpha based on probability (0.2 to 1.0 for visibility)
    min_alpha, max_alpha = 0.2, 1.0
    
    # Get alphas for regular edges
    regular_alphas = [min_alpha + (G[u][v]['weight'] * (max_alpha - min_alpha)) 
                     for u, v in regular_edges]
    
    # Get alphas for self-loops
    self_loop_alphas = [min_alpha + (G[u][v]['weight'] * (max_alpha - min_alpha)) 
                       for u, v in self_loops]
    
    # Draw regular edges with varying opacity
    nx.draw_networkx_edges(G, pos, edgelist=regular_edges, node_size=2000, 
                          arrowsize=20, arrowstyle='->', width=2, 
                          connectionstyle='arc3,rad=0.05', edge_color='black',
                          alpha=regular_alphas)
    
    # Draw self-loops with varying opacity
    nx.draw_networkx_edges(G, pos, edgelist=self_loops, node_size=2000,
                          arrowsize=20, arrowstyle='->', width=2, 
                          connectionstyle='arc3,rad=0.2', edge_color='black',
                          alpha=self_loop_alphas)
    
    # Get edge labels
    edge_labels = nx.get_edge_attributes(G, "label")
    
    # Draw edge labels for regular edges with adjustable positioning to avoid overlap
    regular_edge_labels = {(u, v): label for (u, v), label in edge_labels.items() if u != v}
    nx.draw_networkx_edge_labels(G, pos, edge_labels=regular_edge_labels, font_color="black", 
                                font_size=9, font_weight="normal", label_pos=0.35, bbox=dict(alpha=0),
                                font_family='Times New Roman', rotate=False)
    
    # Draw self-loop labels manually with better positioning
    for (u, v), label in edge_labels.items():
        if u == v:  # self-loop
            node_pos = pos[u]
            # Position label radially outward from center (0,0)
            label_offset = 0.23
            # Calculate angle from center
            angle = np.arctan2(node_pos[1], node_pos[0])
            # Position label along the same angle, further out
            label_pos = (node_pos[0] + label_offset * np.cos(angle), 
                        node_pos[1] + label_offset * np.sin(angle))
            plt.text(label_pos[0], label_pos[1], label, fontsize=9, fontweight='normal',
                    color='black', ha='center', va='center', family='Times New Roman')

    plt.axis("off")
    plt.tight_layout()
    plt.show()
    
    
    
