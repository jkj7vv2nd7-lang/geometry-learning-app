import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import backend.ai_agent as ai_agent


class LessonPlanTests(unittest.TestCase):
    def test_prompt_requires_assessment_plan_and_detailed_plan_for_every_period(self):
        prompt = ai_agent.LESSON_PLAN_SYSTEM
        self.assertIn("全ての時間の詳細な授業展開案", prompt)
        self.assertIn("評価方法・記録する証拠", prompt)
        self.assertIn("第1時から最終時まで", prompt)
        self.assertIn("つまずきへの手立て", prompt)
        self.assertIn("3000〜5000字", prompt)

    def test_template_provides_a_detailed_progression_for_all_five_periods(self):
        plan = ai_agent._template_lesson_plan(
            "三角形の性質を探究する",
            "中学校",
            {"title": "三角形", "measurements": {"summary": "辺AB=4"}},
        )
        for index in range(1, 6):
            self.assertIn(f"### 第{index}時", plan)
        self.assertIn("単元の指導・評価計画（全5時間）", plan)
        self.assertIn("B：おおむね満足", plan)
        self.assertIn("A：十分満足", plan)
        self.assertIn("評価（観点・方法）", plan)
        self.assertIn("辺AB=4", plan)

    def test_teacher_mode_without_ai_returns_multiperiod_fallback(self):
        with patch.object(ai_agent, "get_active_provider", return_value="none"):
            content = ai_agent.generate_educational_content(
                "三角形の性質を探究する",
                "中学校",
                "teacher",
                {"title": "三角形", "measurements": {"summary": "辺AB=4"}},
            )

        self.assertEqual(content.provider, "none")
        self.assertEqual(content.lesson_plan.count("### 第"), 5)
        self.assertGreater(len(content.lesson_plan), 4000)

    def test_ai_lesson_plan_request_uses_extended_output_budget(self):
        calls = []

        def generate(_system, _user, **kwargs):
            calls.append(kwargs)
            return "生成結果", "openai"

        with patch.object(ai_agent, "get_active_provider", return_value="openai"), \
             patch.object(ai_agent, "_generate_text_auto", side_effect=generate):
            content = ai_agent.generate_educational_content(
                "図形の性質", mode="teacher", geometry={"title": "三角形"}
            )

        self.assertEqual(content.lesson_plan, "生成結果")
        self.assertIn(
            {"max_output_tokens": ai_agent.LESSON_PLAN_MAX_OUTPUT_TOKENS},
            calls,
        )

    def test_openai_receives_lesson_plan_output_budget(self):
        completion = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="計画"))]
        )
        create = Mock(return_value=completion)
        client = SimpleNamespace(chat=SimpleNamespace(
            completions=SimpleNamespace(create=create)
        ))
        openai_module = SimpleNamespace(OpenAI=Mock(return_value=client))
        with patch.object(ai_agent, "_has_openai_key", return_value=True), \
             patch.dict(sys.modules, {"openai": openai_module}):
            result = ai_agent._generate_text_with_openai(
                "system", "user", max_output_tokens=ai_agent.LESSON_PLAN_MAX_OUTPUT_TOKENS
            )

        self.assertEqual(result, "計画")
        self.assertEqual(
            create.call_args.kwargs["max_completion_tokens"],
            ai_agent.LESSON_PLAN_MAX_OUTPUT_TOKENS,
        )

    def test_gemini_receives_lesson_plan_output_budget(self):
        response = SimpleNamespace(text="計画")
        generate_content = Mock(return_value=response)
        client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
        genai_module = SimpleNamespace(Client=Mock(return_value=client))
        import google

        with patch.object(ai_agent, "_has_gemini_key", return_value=True), \
             patch.object(ai_agent, "_gemini_key", return_value="test-key"), \
             patch.object(ai_agent, "_gemini_model_candidates", return_value=["test-model"]), \
             patch.object(google, "genai", genai_module, create=True):
            result = ai_agent._generate_text_with_gemini(
                "system", "user", max_output_tokens=ai_agent.LESSON_PLAN_MAX_OUTPUT_TOKENS
            )

        self.assertEqual(result, "計画")
        self.assertEqual(
            generate_content.call_args.kwargs["config"]["max_output_tokens"],
            ai_agent.LESSON_PLAN_MAX_OUTPUT_TOKENS,
        )


if __name__ == "__main__":
    unittest.main()
