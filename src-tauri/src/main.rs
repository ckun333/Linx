// 预编译头加速（可选）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    linx_lib::run()
}
