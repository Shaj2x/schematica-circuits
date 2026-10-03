//! Dense LU factorization with partial pivoting.
//!
//! Why hand-rolled instead of a crate like `nalgebra`:
//! - Circuits that come from a photo or a grid editor have tens of nodes, so
//!   a dense O(n^3) solve takes microseconds. Sparse methods only pay off at
//!   thousands of nodes.
//! - It keeps the WebAssembly bundle small and adds no dependencies.
//! - It is about 60 lines that can be explained in full.
//!
//! Factor and solve are separate steps on purpose. Transient analysis (Phase 3)
//! with a fixed time step keeps the same matrix at every step and changes only
//! the right-hand side, so it can factor once and solve each step in O(n^2).

/// A square matrix stored row-major in one `Vec`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DenseMatrix {
    n: usize,
    data: Vec<f64>,
}

impl DenseMatrix {
    pub fn zeros(n: usize) -> Self {
        DenseMatrix {
            n,
            data: vec![0.0; n * n],
        }
    }

    pub fn size(&self) -> usize {
        self.n
    }

    pub fn get(&self, row: usize, col: usize) -> f64 {
        self.data[row * self.n + col]
    }

    /// Adds `value` to entry (row, col). MNA builds its matrix by summing each
    /// element's contribution ("stamp"), so `add` is the main write operation.
    pub fn add(&mut self, row: usize, col: usize, value: f64) {
        self.data[row * self.n + col] += value;
    }

    fn swap_rows(&mut self, r1: usize, r2: usize) {
        if r1 != r2 {
            for c in 0..self.n {
                self.data.swap(r1 * self.n + c, r2 * self.n + c);
            }
        }
    }
}

/// Returned when the matrix has no usable pivot in some column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Singular;

/// The factorization P·A = L·U, stored compactly: U on and above the diagonal,
/// L's multipliers below it (L's unit diagonal is implicit), and P as a row
/// permutation.
#[derive(Debug, Clone)]
pub(crate) struct LuFactors {
    lu: DenseMatrix,
    /// `perm[i]` is the row of the original matrix now at row `i`.
    perm: Vec<usize>,
}

impl LuFactors {
    /// Gaussian elimination with partial pivoting: for each column, the row
    /// with the largest entry becomes the pivot row. That bounds the
    /// multipliers by 1 and keeps rounding error under control, which matters
    /// here because circuit matrices mix conductances (around 1e-3 S) with the
    /// exact ±1 entries from voltage sources.
    pub fn factor(mut a: DenseMatrix) -> Result<Self, Singular> {
        let n = a.size();
        let mut perm: Vec<usize> = (0..n).collect();

        // A pivot this small relative to the largest entry is treated as zero.
        // A structurally singular circuit shows up as an exact 0, or a value
        // near machine epsilon after rounding, not as a modestly small number.
        let scale = a.data.iter().fold(0.0_f64, |m, v| m.max(v.abs()));
        let tolerance = scale * f64::EPSILON * n.max(1) as f64;

        for k in 0..n {
            let pivot_row = (k..n)
                .max_by(|&i, &j| a.get(i, k).abs().total_cmp(&a.get(j, k).abs()))
                .expect("range k..n is non-empty");
            if a.get(pivot_row, k).abs() <= tolerance {
                return Err(Singular);
            }
            a.swap_rows(k, pivot_row);
            perm.swap(k, pivot_row);

            let pivot = a.get(k, k);
            for i in (k + 1)..n {
                let multiplier = a.get(i, k) / pivot;
                a.data[i * n + k] = multiplier; // store L below the diagonal
                if multiplier != 0.0 {
                    for j in (k + 1)..n {
                        a.data[i * n + j] -= multiplier * a.data[k * n + j];
                    }
                }
            }
        }
        Ok(LuFactors { lu: a, perm })
    }

    /// Solves A·x = b using the stored factors: permute b, then forward
    /// substitution (L·y = P·b), then back substitution (U·x = y).
    pub fn solve(&self, b: &[f64]) -> Vec<f64> {
        let n = self.lu.size();
        assert_eq!(b.len(), n, "right-hand side has the wrong length");
        let mut x: Vec<f64> = self.perm.iter().map(|&p| b[p]).collect();
        for i in 0..n {
            for j in 0..i {
                x[i] -= self.lu.get(i, j) * x[j];
            }
        }
        for i in (0..n).rev() {
            for j in (i + 1)..n {
                x[i] -= self.lu.get(i, j) * x[j];
            }
            x[i] /= self.lu.get(i, i);
        }
        x
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matrix(rows: &[&[f64]]) -> DenseMatrix {
        let mut m = DenseMatrix::zeros(rows.len());
        for (r, row) in rows.iter().enumerate() {
            for (c, &v) in row.iter().enumerate() {
                m.add(r, c, v);
            }
        }
        m
    }

    fn assert_vec_close(actual: &[f64], expected: &[f64]) {
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 1e-12, "{actual:?} != {expected:?}");
        }
    }

    #[test]
    fn solves_small_system() {
        // 2x + y = 5, x + 3y = 10  ->  x = 1, y = 3
        let lu = LuFactors::factor(matrix(&[&[2.0, 1.0], &[1.0, 3.0]])).unwrap();
        assert_vec_close(&lu.solve(&[5.0, 10.0]), &[1.0, 3.0]);
    }

    #[test]
    fn pivots_past_zero_on_diagonal() {
        // A zero in the (0, 0) position, as voltage-source rows produce in
        // MNA. Without pivoting this would divide by zero.
        let lu = LuFactors::factor(matrix(&[&[0.0, 1.0], &[1.0, 0.0]])).unwrap();
        assert_vec_close(&lu.solve(&[2.0, 7.0]), &[7.0, 2.0]);
    }

    #[test]
    fn reuses_factors_for_new_right_hand_sides() {
        let a = matrix(&[&[4.0, -2.0, 1.0], &[-2.0, 4.0, -2.0], &[1.0, -2.0, 4.0]]);
        let lu = LuFactors::factor(a.clone()).unwrap();
        for x in [[1.0, 2.0, 3.0], [-1.0, 0.5, 0.0]] {
            // Build b = A·x, then check that solving recovers x.
            let b: Vec<f64> = (0..3)
                .map(|r| (0..3).map(|c| a.get(r, c) * x[c]).sum())
                .collect();
            assert_vec_close(&lu.solve(&b), &x);
        }
    }

    #[test]
    fn rejects_singular_matrix() {
        // Second row is twice the first.
        let result = LuFactors::factor(matrix(&[&[1.0, 2.0], &[2.0, 4.0]]));
        assert_eq!(result.unwrap_err(), Singular);
    }

    #[test]
    fn rejects_zero_matrix() {
        assert_eq!(
            LuFactors::factor(DenseMatrix::zeros(3)).unwrap_err(),
            Singular
        );
    }
}
